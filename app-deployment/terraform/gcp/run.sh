#!/bin/bash

# for log file creation
LOG_FILE="deploy_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1



SECONDS=0


if ! command -v gcloud &> /dev/null; then
    echo "gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi


PROJECT_ID="app-microservices-cm"
DEFAULT_REGION="us-east1"
DEFAULT_CP_MACHINE_TYPE="e2-custom-8-32768"
DEFAULT_CP_COUNT=1
DEFAULT_CP_IMAGE_FAMILY=""
DEFAULT_WORKER_MACHINE_TYPE="e2-custom-4-16384"
DEFAULT_WORKER_COUNT=2
DEFAULT_WORKER_IMAGE_FAMILY=""
DEFAULT_NAME_PREFIX="ndm-auto"
NAME_TIMESTAMP=$(date +%Y%m%d%H%M%S)



# Get latest images
# DEFAULT_CP_IMAGE=$(gcloud compute images list \
#   --project="${PROJECT_ID}" \
#   --filter="name~'cp|control-plane'" \
#   --sort-by="~creationTimestamp" \
#   --limit=1 \
#   --format="get(selfLink)")
# DEFAULT_WORKER_IMAGE=$(gcloud compute images list \
#   --project="${PROJECT_ID}" \
#   --filter="name~'worker'" \
#   --sort-by="~creationTimestamp" \
#   --limit=1 \
#   --format="get(selfLink)")

DEFAULT_CP_IMAGE="datamigrator-control-plane-06-09-2025-19-10-00"
DEFAULT_WORKER_IMAGE="datamigrator-worker-06-09-2025-19-05-14"

read -p "Enter name prefix for instances [${DEFAULT_NAME_PREFIX}]: " NAME_PREFIX
NAME_PREFIX=${NAME_PREFIX:-${DEFAULT_NAME_PREFIX:-$NAME_PREFIX}}

read -p "Enter number of control plane nodes [${DEFAULT_CP_COUNT}]: " CONTROL_PLANE_COUNT
CONTROL_PLANE_COUNT=${CONTROL_PLANE_COUNT:-$DEFAULT_CP_COUNT}

read -p "Enter number of worker nodes [${DEFAULT_WORKER_COUNT}]: " WORKER_COUNT
WORKER_COUNT=${WORKER_COUNT:-$DEFAULT_WORKER_COUNT}

VM_COUNT=$((CONTROL_PLANE_COUNT + WORKER_COUNT))

read -p "Enter machine type for all control plane nodes [${DEFAULT_CP_MACHINE_TYPE}]: " CP_MACHINE_TYPE
CP_MACHINE_TYPE=${CP_MACHINE_TYPE:-$DEFAULT_CP_MACHINE_TYPE}

read -p "Enter image for control plane [${DEFAULT_CP_IMAGE}]: " CP_IMAGE
CP_IMAGE=${CP_IMAGE:-$DEFAULT_CP_IMAGE}

read -p "Enter machine type for all worker nodes [${DEFAULT_WORKER_MACHINE_TYPE}]: " WORKER_MACHINE_TYPE
WORKER_MACHINE_TYPE=${WORKER_MACHINE_TYPE:-$DEFAULT_WORKER_MACHINE_TYPE}

read -p "Enter image for worker [${DEFAULT_WORKER_IMAGE}]: " WORKER_IMAGE
WORKER_IMAGE=${WORKER_IMAGE:-$DEFAULT_WORKER_IMAGE}

read -p "Enter your GCP region [${DEFAULT_REGION}]: " REGION
REGION=${REGION:-$DEFAULT_REGION}

echo name prefix: "$NAME_PREFIX"
echo name default: "$DEFAULT_NAME_PREFIX"



MACHINE_TYPES=()
IMAGES=()
NAMES=()


TODAY_DATE=$(date +%d%m)
BUILD_TIME=$(date +%H%M%S)
UNIQUE_ID=$(date +%s)  # Unix timestamp for extra uniqueness 

# Function to extract image creation date from image URL/name
get_image_date() {
    local image_url="$1"
    if [ -n "$image_url" ]; then
        # Extract image name from the URL (handle both full URLs and just names)
        local image_name
        if [[ "$image_url" == *"/"* ]]; then
            image_name=$(basename "$image_url")
        else
            image_name="$image_url"
        fi

        echo "Extracting date from image: $image_name" >&2

        local date_part=$(echo "$image_name" | grep -oE '[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}')
        local day_month=$(echo "$date_part" | cut -d'-' -f1,2)
        local day=$(echo "$day_month" | cut -d'-' -f1)
        local month=$(echo "$day_month" | cut -d'-' -f2)
        local image_date="${day}${month}"
        echo "$image_date"
    fi
        
}

# image creation dates
CP_IMAGE_DATE=$(get_image_date "$CP_IMAGE")
WORKER_IMAGE_DATE=$(get_image_date "$WORKER_IMAGE")

echo name prefix: "$NAME_PREFIX"

# UNIQUE NAMES - Keep them shorter to avoid 63-char limit
SHORT_TIMESTAMP="${BUILD_TIME:0:4}${UNIQUE_ID: -4}"  # Combine for shorter unique ID

for i in $(seq 1 $CONTROL_PLANE_COUNT); do
  MACHINE_TYPES+=("$CP_MACHINE_TYPE")
  IMAGES+=("$CP_IMAGE")
  NAMES+=("cp-${CP_IMAGE_DATE}-${SHORT_TIMESTAMP}-${NAME_PREFIX}")
done

for i in $(seq 1 $WORKER_COUNT); do
  MACHINE_TYPES+=("$WORKER_MACHINE_TYPE")
  IMAGES+=("$WORKER_IMAGE")
  NAMES+=("wk-${WORKER_IMAGE_DATE}-${SHORT_TIMESTAMP}-${NAME_PREFIX}-${i}")
done

MACHINE_TYPES_JSON=$(printf '%s\n' "${MACHINE_TYPES[@]}" | jq -R . | jq -s .)
IMAGES_JSON=$(printf '%s\n' "${IMAGES[@]}" | jq -R . | jq -s .)
NAMES_JSON=$(printf '%s\n' "${NAMES[@]}" | jq -R . | jq -s .)

echo Images JSON: "$IMAGES_JSON"
echo Machine Types JSON: "$MACHINE_TYPES_JSON"
echo Instance Names JSON: "$NAMES_JSON"


export TF_VAR_project_id=$PROJECT_ID
export TF_VAR_region=$REGION
export TF_VAR_vm_count=$VM_COUNT
export TF_VAR_name_prefix=$NAME_PREFIX
export TF_VAR_machine_types="$MACHINE_TYPES_JSON"
export TF_VAR_images="$IMAGES_JSON"
export TF_VAR_control_plane_count=$CONTROL_PLANE_COUNT
export TF_VAR_worker_count=$WORKER_COUNT
export TF_VAR_instance_names="$NAMES_JSON"


echo "Initializing Terraform..."
terraform init

# Create a unique workspace for this deployment to avoid conflicts
# Use shorter workspace name to avoid 63-char limit
WORKSPACE_NAME="${BUILD_TIME:0:6}-${UNIQUE_ID: -6}"  # Take first 6 chars of time and last 6 of timestamp
echo "Creating Terraform workspace: $WORKSPACE_NAME"
terraform workspace new "$WORKSPACE_NAME" || terraform workspace select "$WORKSPACE_NAME"

echo "Creating new Terraform infrastructure in workspace: $WORKSPACE_NAME"
terraform apply -auto-approve

# Enhanced deployment verification with control plane readiness check and SSH setup
if [ $? -eq 0 ]; then
    echo ""
    echo "===== DEPLOYMENT SUCCESSFUL ====="
    echo ""
    
    echo "Waiting for resources to be fully ready..."
    sleep 10
    
    # Refresh terraform state
    terraform refresh
    
    # Get IPs and VM names
    CP_IPS=""
    WORKER_IPS=""
    VM_NAMES=""
    
    echo "Retrieving deployment information..."
    if terraform output control_plane_internal_ips > /dev/null 2>&1; then
        CP_IPS=$(terraform output -json control_plane_internal_ips | jq -r '.[]')
        echo "Control Plane IPs retrieved"
    else
        echo "Unable to retrieve control plane IPs"
        exit 1
    fi
    
    if terraform output worker_internal_ips > /dev/null 2>&1; then
        WORKER_IPS=$(terraform output -json worker_internal_ips | jq -r '.[]')
        echo "Worker IPs retrieved"
    else
        echo "Unable to retrieve worker IPs"
        exit 1
    fi
    
    # Get VM names and zones from terraform state
    VM_INFO=$(terraform show -json | jq -r '.values.root_module.resources[] | select(.type=="google_compute_instance") | "\(.values.name)|\(.values.zone)"')
    if [ -z "$VM_INFO" ]; then
        echo "Unable to retrieve VM information"
        exit 1
    fi
    echo "VM information retrieved"
    
    # Setup SSH keys for all VMs
    echo ""
    echo "Setting up SSH access for all VMs..."
    SSH_KEYS_DIR="/tmp/ndm-ssh-keys-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$SSH_KEYS_DIR"
    
    # Function to generate SSH key pair
    generate_ssh_key() {
        local vm_name="$1"

        # Create temporary key files (will be deleted immediately)
        local temp_dir=$(mktemp -d)
        local key_path="${temp_dir}/${vm_name}_key"

        # Generate SSH key pair
        ssh-keygen -t rsa -b 2048 -f "$key_path" -N "" -C "ndmuser@${vm_name}" -q

        if [ $? -eq 0 ]; then
            echo "SSH key generated for $vm_name" >&2

            # Read both private and public key content
            local private_key=$(cat "$key_path" | base64 -w 0)  # Base64 encode to handle newlines
            local public_key=$(cat "${key_path}.pub")

            # Clean up temporary files immediately
            rm -rf "$temp_dir"

            # Return both keys in a structured format
            echo "${private_key}|${public_key}"
            return 0
        else
            echo "Failed to generate SSH key for $vm_name" >&2
            rm -rf "$temp_dir"
            return 1
        fi
    }
    
    # Function to add SSH key to VM
   add_ssh_key_to_vm() {
    local vm_name="$1"
    local vm_zone="$2" 
    local public_key_content="$3"
    
    # Debug: show what we're setting
    echo "Setting SSH key for $vm_name:" >&2
    echo "Key content: $public_key_content" >&2
    
    # Format: username:ssh-key-type key-data optional-comment
    local ssh_keys="ndmuser:$public_key_content"
    
    # Get existing SSH keys from VM to avoid overwriting
    existing_keys=$(gcloud compute instances describe "$vm_name" \
        --zone="$vm_zone" \
        --project="$PROJECT_ID" \
        --format="value(metadata.items[key=ssh-keys].value)" 2>/dev/null || echo "")
    
    # Combine existing and new keys
    if [ -n "$existing_keys" ]; then
        all_ssh_keys="${existing_keys}\n${ssh_keys}"
    else
        all_ssh_keys="$ssh_keys"
    fi
    
    # Add SSH key to VM metadata
    gcloud compute instances add-metadata "$vm_name" \
        --zone="$vm_zone" \
        --metadata ssh-keys="$all_ssh_keys" \
        --project="$PROJECT_ID" >/dev/null 2>&1
        
    if [ $? -eq 0 ]; then
        echo "SSH key added to $vm_name" >&2  # Send log to stderr
        
        # Debug: verify what was actually set
        verification=$(gcloud compute instances describe "$vm_name" \
            --zone="$vm_zone" \
            --project="$PROJECT_ID" \
            --format="value(metadata.items[key=ssh-keys].value)" 2>/dev/null)
        echo "Verification - SSH keys now set to:" >&2
        echo "$verification" >&2
        echo "" >&2
        
        return 0
    else
        echo "Failed to add SSH key to $vm_name" >&2
        return 1
    fi
}
    
    # Process each VM for SSH setup
    SSH_KEY_DATA=""
    while IFS='|' read -r vm_name vm_zone; do
        if [ -n "$vm_name" ] && [ -n "$vm_zone" ]; then
            echo "Setting up SSH for VM: $vm_name in zone: $vm_zone"
            # Generate SSH key
            key_data=$(generate_ssh_key "$vm_name")
            if [ $? -eq 0 ] && [ -n "$key_data" ]; then
                echo "SSH key generated for $vm_name"
                # Add SSH key to VM
                private_key=$(echo "$key_data" | cut -d'|' -f1)
                public_key=$(echo "$key_data" | cut -d'|' -f2)
                add_ssh_key_to_vm "$vm_name" "$vm_zone" "${public_key}"
                if [ $? -eq 0 ]; then
                    SSH_KEY_DATA="${SSH_KEY_DATA}${vm_name}:${private_key},"
                fi
            fi
        fi
    done <<< "$VM_INFO"
    
    # Wait for Control Plane to be ready
    FIRST_CP_IP=$(echo "$CP_IPS" | head -n 1)
    if [ -n "$FIRST_CP_IP" ]; then
        echo ""
        echo "Waiting for Control Plane at $FIRST_CP_IP to be ready..."
        echo "This can take up to 30 minutes for initial startup..."
        
        # Control plane readiness check
        wait_for_control_plane() {
            local cp_ip="$1"
            local max_attempts=180  # 30 minutes with 10-second intervals
            local health_url="http://${cp_ip}/health"
            
            echo "Checking health endpoint: $health_url"
            
            for attempt in $(seq 1 $max_attempts); do
                # Use curl with timeout and silent mode
                if curl -f -s --connect-timeout 5 --max-time 10 "$health_url" > /dev/null 2>&1; then
                    echo "Control plane is ready after $attempt attempts ($(($attempt * 10 / 60)) minutes)"
                    echo "Waiting 5 minutes for control plane to stabilize..."
                    sleep 300  # 5 minutes stabilization
                    return 0
                fi
                
                # Log progress every minute (6 attempts)
                if [ $((attempt % 6)) -eq 0 ]; then
                    echo "Still waiting for CP... attempt $attempt/$max_attempts ($(($attempt * 10 / 60)) minutes elapsed)"
                fi
                
                if [ $attempt -lt $max_attempts ]; then
                    sleep 10
                fi
            done
            
            echo "Control plane not ready after 30 minutes"
            return 1
        }
        
        # Wait for control plane
        if wait_for_control_plane "$FIRST_CP_IP"; then
            echo "Control Plane is fully ready and operational!"
        else
            echo "Control Plane health check failed, but deployment completed."
            echo "You may need to wait longer or check the control plane manually."
            exit 1
        fi
    fi
    
    # Output structured data for Go script to parse
    echo ""
    echo "===== NDM_DEPLOYMENT_RESULTS_START ====="
    echo "STATUS:SUCCESS"
    echo "CP_IP:$FIRST_CP_IP"
    echo "WORKER_IPS:$(echo $WORKER_IPS | tr '\n' ',')"
    echo "VM_INFO:$(echo "$VM_INFO" | tr '\n' ',')"
    echo "SSH_KEYS_DATA:$SSH_KEY_DATA"
    echo "LOG_FILE:$LOG_FILE"
    echo "===== NDM_DEPLOYMENT_RESULTS_END ====="
    
else
    echo "Terraform apply failed!"
    echo ""
    echo "===== NDM_DEPLOYMENT_RESULTS_START ====="
    echo "STATUS:FAILED"
    echo "ERROR:Terraform apply failed"
    echo "LOG_FILE:$LOG_FILE"
    echo "===== NDM_DEPLOYMENT_RESULTS_END ====="
    exit 1
fi

duration=$SECONDS
echo "Total script time: $(($duration / 60)) minutes and $(($duration % 60)) seconds."
echo "Log saved to $LOG_FILE"