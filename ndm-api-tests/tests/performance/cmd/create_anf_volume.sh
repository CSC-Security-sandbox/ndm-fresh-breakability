#!/bin/bash

# create_anf_volume.sh - Script to recreate Azure NetApp Files volume
# Usage: ./create_anf_volume.sh -u <username> [-s <size_gb>]

set -e

# Default values
USERNAME=""
VOLUME_SIZE_GB=1024
DRY_RUN=false
DATE_SUFFIX=""
SEQUENCE_NUMBER="1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform-anf"
OUTPUT_FILE="${SCRIPT_DIR}/anf_volume_info.txt"

# Function to display usage
usage() {
    echo "Usage: $0 -u <username> [-s <size_gb>] [-d] [-t <YYYYMMDD>] [-n <sequence>]"
    echo "  -u: Username prefix for volume tagging (required)"
    echo "  -s: Volume size in GB (default: 1024)"
    echo "  -d: Dry run mode (plan only, no actual changes)"
    echo "  -t: Date suffix in YYYYMMDD format (default: current date)"
    echo "  -n: Sequence number (default: 1)"
    echo "  -h: Display this help message"
    echo ""
    echo "Volume naming convention: vol-dst-perf-YYYYMMDD-N"
    echo "Example: vol-dst-perf-20250902-1"
    exit 1
}

# Parse command line arguments
while getopts "u:s:dt:n:h" opt; do
    case ${opt} in
        u )
            USERNAME=$OPTARG
            ;;
        s )
            VOLUME_SIZE_GB=$OPTARG
            ;;
        d )
            DRY_RUN=true
            ;;
        t )
            DATE_SUFFIX=$OPTARG
            ;;
        n )
            SEQUENCE_NUMBER=$OPTARG
            ;;
        h )
            usage
            ;;
        \? )
            echo "Invalid option: $OPTARG" 1>&2
            usage
            ;;
    esac
done

# Check if username is provided
if [ -z "$USERNAME" ]; then
    echo "Error: Username is required"
    usage
fi

# Generate date suffix if not provided
if [ -z "$DATE_SUFFIX" ]; then
    DATE_SUFFIX=$(date +%Y%m%d)
fi

# Generate volume name for display
VOLUME_NAME="vol-dst-perf-${DATE_SUFFIX}-${SEQUENCE_NUMBER}"

echo "=== Azure NetApp Files Volume Recreation Script ==="
echo "Username: $USERNAME"
echo "Volume Size: ${VOLUME_SIZE_GB}GB (1TB)"
echo "Volume Name: $VOLUME_NAME"
echo "Date Suffix: $DATE_SUFFIX"
echo "Sequence Number: $SEQUENCE_NUMBER"
echo "Terraform Directory: $TERRAFORM_DIR"
if [ "$DRY_RUN" = true ]; then
    echo "Mode: DRY RUN (plan only, no actual changes)"
else
    echo "Mode: FULL EXECUTION (will make actual changes)"
fi
echo ""

# Change to terraform directory
cd "$TERRAFORM_DIR"

# Check if Azure CLI is logged in
if ! az account show > /dev/null 2>&1; then
    echo "Error: Azure CLI not logged in. Please run 'az login' first"
    exit 1
fi

echo "Step 1: Initializing Terraform..."
if ! terraform init; then
    echo "Error: Terraform initialization failed"
    exit 1
fi

echo ""
echo "Step 2: Deleting ALL existing volumes in the capacity pool..."
# Delete all existing volumes in the capacity pool first
if [ "$DRY_RUN" = true ]; then
    echo "DRY RUN: Would delete all existing volumes in KB-NFS-PERF-AUTO/KB-NFS-PERF-AUTO-CP..."
    az netappfiles volume list \
        --resource-group MigrationAsAService-dev-infra \
        --account-name KB-NFS-PERF-AUTO \
        --pool-name KB-NFS-PERF-AUTO-CP \
        --query "[].name" \
        --output tsv | while read volume_name; do
        if [ -n "$volume_name" ]; then
            # Extract just the volume name (last part after the last /)
            actual_volume_name=$(basename "$volume_name")
            echo "DRY RUN: Would delete volume: $actual_volume_name"
        fi
    done
else
    echo "Deleting all existing volumes in KB-NFS-PERF-AUTO/KB-NFS-PERF-AUTO-CP..."
    az netappfiles volume list \
        --resource-group MigrationAsAService-dev-infra \
        --account-name KB-NFS-PERF-AUTO \
        --pool-name KB-NFS-PERF-AUTO-CP \
        --query "[].name" \
        --output tsv | while read volume_name; do
        if [ -n "$volume_name" ]; then
            # Extract just the volume name (last part after the last /)
            actual_volume_name=$(basename "$volume_name")
            echo "Deleting volume: $actual_volume_name"
            az netappfiles volume delete \
                --resource-group MigrationAsAService-dev-infra \
                --account-name KB-NFS-PERF-AUTO \
                --pool-name KB-NFS-PERF-AUTO-CP \
                --name "$actual_volume_name" \
                --yes || echo "Warning: Failed to delete volume $actual_volume_name"
        fi
    done
    echo "Finished deleting all existing volumes"
    # Wait for deletions to complete
    sleep 30
fi

echo ""
echo "Step 3: Destroying any remaining Terraform-managed volume state..."
# Destroy existing Terraform state (ignore errors if nothing exists)
if [ "$DRY_RUN" = true ]; then
    echo "DRY RUN: Would run terraform destroy..."
    terraform plan -destroy \
        -var="username=${USERNAME}" \
        -var="volume_size_gb=${VOLUME_SIZE_GB}" \
        -var="date_suffix=${DATE_SUFFIX}" \
        -var="sequence_number=${SEQUENCE_NUMBER}" || true
else
    terraform destroy -auto-approve \
        -var="username=${USERNAME}" \
        -var="volume_size_gb=${VOLUME_SIZE_GB}" \
        -var="date_suffix=${DATE_SUFFIX}" \
        -var="sequence_number=${SEQUENCE_NUMBER}" || true
fi

echo ""
echo "Step 4: Creating new volume..."
# Wait a bit for Azure to process the deletion
if [ "$DRY_RUN" != true ]; then
    sleep 30
fi

# Create new volume
if [ "$DRY_RUN" = true ]; then
    echo "DRY RUN: Would run terraform apply..."
    if ! terraform plan \
        -var="username=${USERNAME}" \
        -var="volume_size_gb=${VOLUME_SIZE_GB}" \
        -var="date_suffix=${DATE_SUFFIX}" \
        -var="sequence_number=${SEQUENCE_NUMBER}"; then
        echo "Error: Terraform plan failed"
        exit 1
    fi
    echo ""
    echo "DRY RUN: Terraform plan completed successfully!"
    echo "In actual run, this would create the volume."
    echo "Simulated outputs:"
    echo "DESTINATION_HOST_IP=10.x.x.x (would be determined after creation)"
    echo "EXPORT_PATH=/${VOLUME_NAME}"
    echo "VOLUME_NAME=${VOLUME_NAME}"
    exit 0
else
    if ! terraform apply -auto-approve \
        -var="username=${USERNAME}" \
        -var="volume_size_gb=${VOLUME_SIZE_GB}" \
        -var="date_suffix=${DATE_SUFFIX}" \
        -var="sequence_number=${SEQUENCE_NUMBER}"; then
        echo "Error: Failed to create new ANF volume"
        exit 1
    fi
fi

echo ""
echo "Step 4: Extracting volume information..."
# Extract outputs
DESTINATION_HOST_IP=$(terraform output -raw destination_host_ip 2>/dev/null || echo "")
EXPORT_PATH=$(terraform output -raw export_path 2>/dev/null || echo "")
VOLUME_NAME=$(terraform output -raw volume_name 2>/dev/null || echo "")

if [ -z "$DESTINATION_HOST_IP" ] || [ -z "$EXPORT_PATH" ]; then
    echo "Error: Failed to get volume information from Terraform outputs"
    exit 1
fi

# Write volume information to output file
cat > "$OUTPUT_FILE" << EOF
DESTINATION_HOST_IP=${DESTINATION_HOST_IP}
EXPORT_PATH=${EXPORT_PATH}
VOLUME_NAME=${VOLUME_NAME}
EOF

echo ""
echo "=== Volume Recreation Completed Successfully ==="
echo "Volume Name: $VOLUME_NAME"
echo "Volume Size: ${VOLUME_SIZE_GB}GB (1TB)"
echo "Destination Host IP: $DESTINATION_HOST_IP"
echo "Export Path: $EXPORT_PATH"
echo ""
echo "Volume information saved to: $OUTPUT_FILE"
echo ""

# Verify volume is accessible (optional ping test)
echo "Step 5: Verifying volume accessibility..."
if ping -c 1 "$DESTINATION_HOST_IP" > /dev/null 2>&1; then
    echo "Volume IP is pingable"
else
    echo "Warning: Volume IP is not immediately pingable (this may be normal)"
fi

echo ""
echo "ANF Volume recreation completed successfully!"
echo "   Volume: $VOLUME_NAME (1TB)"
echo "   Mount: ${DESTINATION_HOST_IP}:${EXPORT_PATH}"
