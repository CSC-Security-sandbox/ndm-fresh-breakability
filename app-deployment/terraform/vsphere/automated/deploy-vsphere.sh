#!/bin/bash

# vSphere VM Deployment Automation Script with Integrated Template Discovery
# This script automatically discovers the latest templates and deploys VMs using Terraform

set -euo pipefail

# Configuration
CONTENT_LIBRARY_ID=""
VSPHERE_REST_TIMEOUT=30

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    if [[ "${DEBUG:-false}" == "true" ]]; then
        echo -e "${BLUE}[DEBUG]${NC} $1"
    fi
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Function to check required environment variables for vSphere authentication
check_vsphere_auth() {
    local missing_vars=()
    
    if [[ -z "${VSPHERE_SERVER:-}" ]]; then
        missing_vars+=("VSPHERE_SERVER")
    fi
    if [[ -z "${VSPHERE_USER:-}" ]]; then
        missing_vars+=("VSPHERE_USER")
    fi
    if [[ -z "${VSPHERE_PASSWORD:-}" ]]; then
        missing_vars+=("VSPHERE_PASSWORD")
    fi
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        log_error "Missing required vSphere authentication variables: ${missing_vars[*]}"
        log_info "Please set: VSPHERE_SERVER, VSPHERE_USER, and VSPHERE_PASSWORD"
        return 1
    fi
    
    return 0
}

# Function to authenticate with vSphere REST API and get session ID
get_vsphere_session() {
    local auth_url="https://${VSPHERE_SERVER}/rest/com/vmware/cis/session"
    
    log_debug "Authenticating with vSphere server: ${VSPHERE_SERVER}"
    
    local session_response
    session_response=$(curl -k -s -X POST \
        --connect-timeout ${VSPHERE_REST_TIMEOUT} \
        --max-time ${VSPHERE_REST_TIMEOUT} \
        -u "${VSPHERE_USER}:${VSPHERE_PASSWORD}" \
        -H "Content-Type: application/json" \
        "${auth_url}" 2>/dev/null) || {
        log_error "Failed to connect to vSphere server. Please check your network connection and credentials."
        return 1
    }
    
    if ! echo "${session_response}" | jq -e '.value' > /dev/null 2>&1; then
        log_error "Authentication failed. Please check your vSphere credentials."
        log_error "Response: ${session_response}"
        return 1
    fi
    
    echo "${session_response}" | jq -r '.value'
}

# Function to find the latest templates automatically
find_latest_templates() {
    local session_id="$1"
    
    log_step "🔍 Scanning content library for latest templates..."
    
    # Get all items from the library
    local library_url="https://${VSPHERE_SERVER}/rest/com/vmware/content/library/item?library_id=${CONTENT_LIBRARY_ID}"
    local items_response
    items_response=$(curl -k -s -H "vmware-api-session-id: $session_id" \
        "${library_url}" 2>/dev/null) || {
        log_error "Failed to fetch content library items"
        return 1
    }
    
    if ! echo "${items_response}" | jq -e '.value' > /dev/null 2>&1; then
        log_error "Failed to get library items"
        log_error "Response: ${items_response}"
        return 1
    fi
    
    local items
    items=$(echo "${items_response}" | jq -r '.value[]')
    
    if [[ -z "${items}" ]]; then
        log_error "No items found in content library"
        return 1
    fi
    
    local total_items
    total_items=$(echo "${items}" | wc -l | tr -d ' ')
    log_info "Found $total_items items in content library"
    
    # Arrays to store templates
    local control_plane_templates=()
    local worker_templates=()
    
    # Process items to find templates
    local processed=0
    log_info "Processing templates..."
    
    # Process last 50 items for performance (most recent)
    local sample_items
    sample_items=$(echo "${items}" | tail -50)
    
    while IFS= read -r item_id; do
        [[ -z "${item_id}" ]] && continue
        
        processed=$((processed + 1))
        if [[ $((processed % 10)) -eq 0 ]]; then
            log_debug "Processed ${processed}/50 items..."
        fi
        
        # Get item details
        local item_details
        item_details=$(curl -k -s -H "vmware-api-session-id: $session_id" \
            "https://${VSPHERE_SERVER}/rest/com/vmware/content/library/item/id:$item_id" 2>/dev/null)
        
        if [[ -n "$item_details" ]]; then
            local item_name
            item_name=$(echo "$item_details" | jq -r '.value.name // ""')
            local item_type
            item_type=$(echo "$item_details" | jq -r '.value.type // ""')
            local creation_time
            creation_time=$(echo "$item_details" | jq -r '.value.creation_time // ""')
            
            # Only process OVF templates
            if [[ "$item_type" == "ovf" && -n "$creation_time" ]]; then
                # Check for control plane templates
                if [[ "$item_name" == *"datamigrator-control-plane"* ]]; then
                    control_plane_templates+=("$creation_time|$item_name")
                    log_debug "Found control plane: $item_name"
                # Check for worker templates
                elif [[ "$item_name" == *"datamigrator-worker"* ]]; then
                    worker_templates+=("$creation_time|$item_name")
                    log_debug "Found worker: $item_name"
                fi
            fi
        fi
    done <<< "${sample_items}"
    
    # Validate we found templates
    if [[ ${#control_plane_templates[@]} -eq 0 ]]; then
        log_error "No control plane templates found matching pattern 'datamigrator-control-plane'"
        return 1
    fi
    
    if [[ ${#worker_templates[@]} -eq 0 ]]; then
        log_error "No worker templates found matching pattern 'datamigrator-worker'"
        return 1
    fi
    
    # Sort by creation time and get the latest
    local latest_control_plane
    latest_control_plane=$(printf '%s\n' "${control_plane_templates[@]}" | sort -r | head -1 | cut -d'|' -f2)
    
    local latest_worker
    latest_worker=$(printf '%s\n' "${worker_templates[@]}" | sort -r | head -1 | cut -d'|' -f2)
    
    log_info "Found ${#control_plane_templates[@]} control plane templates, ${#worker_templates[@]} worker templates"
    
    # Export as environment variables for Terraform
    export TF_VAR_control_plane_ovf_template_name="${latest_control_plane}"
    export TF_VAR_worker_ovf_template_name="${latest_worker}"
    
    log_info "✅ Latest templates selected:"
    log_info "   🔹 Control Plane: ${latest_control_plane}"
    log_info "   🔹 Worker: ${latest_worker}"
    
    return 0
}

# Function to discover templates automatically
discover_templates() {
    log_step "🚀 Starting automatic template discovery..."
    
    # Get vSphere session
    local session_id
    session_id=$(get_vsphere_session) || {
        log_error "Failed to authenticate with vSphere"
        return 1
    }
    
    log_info "✅ Successfully authenticated with vSphere"
    
    # Find latest templates
    find_latest_templates "${session_id}" || {
        log_error "Template discovery failed"
        return 1
    }
    
    # Clean up session
    curl -k -s -X DELETE \
        -H "vmware-api-session-id: ${session_id}" \
        "https://${VSPHERE_SERVER}/rest/com/vmware/cis/session" > /dev/null 2>&1 || true
    
    log_info "🎉 Template discovery completed successfully!"
    return 0
}

# Function to run Terraform deployment
run_terraform() {
    local action="apply"
    
    log_step "🔧 Running Terraform ${action}..."
    
    # Check if templates are set
    if [[ -z "${TF_VAR_control_plane_ovf_template_name:-}" || -z "${TF_VAR_worker_ovf_template_name:-}" ]]; then
        log_error "Template names not set! Template discovery may have failed."
        return 1
    fi
    
    # Set Terraform variables from environment variables if not already set
    if [[ -n "${VSPHERE_SERVER:-}" && -z "${TF_VAR_vsphere_server:-}" ]]; then
        export TF_VAR_vsphere_server="${VSPHERE_SERVER}"
    fi
    if [[ -n "${VSPHERE_USER:-}" && -z "${TF_VAR_vsphere_user:-}" ]]; then
        export TF_VAR_vsphere_user="${VSPHERE_USER}"
    fi
    if [[ -n "${VSPHERE_PASSWORD:-}" && -z "${TF_VAR_vsphere_password:-}" ]]; then
        export TF_VAR_vsphere_password="${VSPHERE_PASSWORD}"
    fi
    
    # Validate required Terraform variables are set
    if [[ -z "${TF_VAR_vsphere_server:-}" ]]; then
        log_error "TF_VAR_vsphere_server is not set. Please set VSPHERE_SERVER environment variable."
        return 1
    fi
    if [[ -z "${TF_VAR_vsphere_user:-}" ]]; then
        log_error "TF_VAR_vsphere_user is not set. Please set VSPHERE_USER environment variable."
        return 1
    fi
    if [[ -z "${TF_VAR_vsphere_password:-}" ]]; then
        log_error "TF_VAR_vsphere_password is not set. Please set VSPHERE_PASSWORD environment variable."
        return 1
    fi
    
    # Initialize Terraform
    log_info "Initializing Terraform..."
    terraform init -no-color || {
        log_error "Terraform init failed"
        return 1
    }
    
    log_info "Applying Terraform configuration..."
    terraform apply -auto-approve -no-color || {
        log_error "Terraform apply failed"
        return 1
    }
    log_info "🎉 Terraform deployment completed successfully!"
    
    # Show deployment summary
    log_step "📋 Deployment Summary:"
    terraform output -no-color
    
    log_info "✅ Terraform plan completed successfully!"
}

# Main function
main() {
    # Check if running from GitHub workflow (6 parameters)
    log_info "🚀 Running in GitHub workflow mode"
    
    # Extract workflow parameters
    local name_prefix="$1"
    local worker_count="$2"
    local cp_image="$3"
    local worker_image="$4"
    local ssh_username="$5"
    local ssh_password="$6"
    local content_library_id="$7"
    
    # Set content library ID
    if [[ -n "$content_library_id" ]]; then
        CONTENT_LIBRARY_ID="$content_library_id"
        log_info "Content Library ID: $content_library_id"
    fi

    if [[ -z "$CONTENT_LIBRARY_ID" ]]; then
        log_error "Content Library ID not provided and no default set"
        return 1
    fi

    # Set VM names using name_prefix
    if [[ -n "$name_prefix" ]]; then
        export TF_VAR_cp_vm_name="${name_prefix}-cp"
        export TF_VAR_wk_vm_name="${name_prefix}-wk"
        log_info "VM names set: CP=${name_prefix}-cp, Worker=${name_prefix}-wk"
    fi
    
    # Set worker count
    if [[ -n "$worker_count" ]]; then
        export TF_VAR_worker_count="$worker_count"
        log_info "Worker count: $worker_count"
    fi
    
    # Set SSH credentials
    if [[ -n "$ssh_username" ]]; then
        export TF_VAR_ssh_username="$ssh_username"
        log_info "SSH username: $ssh_username"
    fi
    
    if [[ -n "$ssh_password" ]]; then
        export TF_VAR_ssh_password="$ssh_password"
    fi
    
    # Handle custom images if provided
    if [[ -n "$cp_image" && "$cp_image" != "latest" && "$cp_image" != "" ]]; then
        export TF_VAR_control_plane_ovf_template_name="$cp_image"
        log_info "Using custom control plane image: $cp_image"
    fi
    
    if [[ -n "$worker_image" && "$worker_image" != "latest" && "$worker_image" != "" ]]; then
        export TF_VAR_worker_ovf_template_name="$worker_image"
        log_info "Using custom worker image: $worker_image"
    fi
    
    local action="apply"

    echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN} vSphere VM Deployment Automation with Integrated Template Discovery${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    log_info "Starting vSphere VM deployment automation..."
    log_info "Action: ${action}"
    
    # Enable debug logging if requested
    if [[ "${VERBOSE:-false}" == "true" || "${DEBUG:-false}" == "true" ]]; then
        export DEBUG=true
        log_info "Debug logging enabled"
    fi
    
    # Check if template discovery should be skipped (manual override mode)
    if [[ -n "${TF_VAR_control_plane_ovf_template_name:-}" && -n "${TF_VAR_worker_ovf_template_name:-}" ]]; then
        if [[ -n "${TF_VAR_control_plane_ovf_template_name:-}" && -n "${TF_VAR_worker_ovf_template_name:-}" ]]; then
            log_step "📋 Using manually specified templates:"
            log_info "   🔹 Control Plane: ${TF_VAR_control_plane_ovf_template_name}"
            log_info "   🔹 Worker: ${TF_VAR_worker_ovf_template_name}"
        else
            log_error "Manual override mode requested but template names not provided"
            log_error "Please set TF_VAR_control_plane_ovf_template_name and TF_VAR_worker_ovf_template_name"
            return 1
        fi
    else
        # Check vSphere authentication
        check_vsphere_auth || return 1
        
        # Discover templates automatically
        discover_templates || {
            log_error "Template discovery failed and no manual templates provided"
            log_info "You can provide manual templates by setting:"
            log_info "  export TF_VAR_control_plane_ovf_template_name='your-control-plane-template'"
            log_info "  export TF_VAR_worker_ovf_template_name='your-worker-template'"
            return 1
        }
    fi
    
    # Run Terraform
    run_terraform "${action}" || return 1
    
    echo ""
    echo -e "${GREEN}🎉 Deployment automation completed successfully!${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════════${NC}"
}

# Script usage
show_usage() {
    echo -e "${CYAN}vSphere VM Deployment Automation with Integrated Template Discovery${NC}"
    echo ""
    echo "Usage: $0 [action] [mode] OR $0 [name_prefix] [worker_count] [cp_image] [worker_image] [ssh_username] [ssh_password]"
    echo ""
    echo "CLI Mode:"
    echo "Actions:"
    echo "  apply      - Deploy VMs (default)"
    echo "  plan       - Plan deployment without applying"
    echo "  destroy    - Destroy VMs"
    echo ""
    echo "Modes:"
    echo "  auto           - Auto-discover latest templates (default)"
    echo "  skip-discovery - Use manually specified templates"
    echo ""
    echo "GitHub Workflow Mode (7 parameters):"
    echo "  name_prefix    - Prefix for VM names (creates {prefix}-cp and {prefix}-wk)"
    echo "  worker_count   - Number of worker VMs"
    echo "  cp_image       - Control plane image version (optional, use 'latest' or leave empty for auto)"
    echo "  worker_image   - Worker image version (optional, use 'latest' or leave empty for auto)"
    echo "  ssh_username   - SSH username for VM access"
    echo "  ssh_password   - SSH password for VM access"
    echo "  content_library_id - vSphere content library ID"
    echo ""
    echo "Environment Variables:"
    echo "  Required for auto-discovery:"
    echo "    VSPHERE_SERVER   - vSphere server hostname/IP"
    echo "    VSPHERE_USER     - vSphere username"
    echo "    VSPHERE_PASSWORD - vSphere password"
    echo ""
    echo "  Manual Template Override:"
    echo "    TF_VAR_control_plane_ovf_template_name - Control plane template name"
    echo "    TF_VAR_worker_ovf_template_name        - Worker template name"
    echo ""
    echo "  Optional:"
    echo "    VERBOSE=true     - Enable verbose debug logging"
    echo "    DEBUG=true       - Enable debug logging"
    echo ""
    echo "Examples:"
    echo "  $0                        # Auto-discover templates and deploy"
    echo "  $0 plan                   # Auto-discover templates and plan"
    echo "  $0 destroy                # Auto-discover templates and destroy"
    echo "  $0 apply skip-discovery   # Use manual templates and deploy"
    echo "  VERBOSE=true $0 plan      # Auto-discover with verbose logging"
    echo ""
    echo "Features:"
    echo "  • Automatic latest template discovery from vSphere content library"
    echo "  • Integrated Terraform workflow (init, plan, apply/destroy)"
    echo "  • Support for manual template override"
    echo "  • Comprehensive logging and error handling"
    echo "  • One-command deployment with latest images"
}

# Handle command line arguments
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    show_usage
    exit 0
fi

# Check for required tools
if ! command -v terraform >/dev/null 2>&1; then
    log_error "Terraform is not installed or not in PATH"
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    log_error "curl is not installed or not in PATH"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    log_error "jq is not installed or not in PATH"
    exit 1
fi

# Run main function with arguments
main "$@"
