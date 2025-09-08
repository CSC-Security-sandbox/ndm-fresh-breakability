#!/bin/bash

# Terraform VM Creation Script
# This script replaces the createAzureVMs() Go function

set -e

# Default values
TERRAFORM_DIR="./terraform"
USERNAME=""
CP_IMAGE_VERSION=""
WORKER_IMAGE_VERSION=""

# Function to display usage
usage() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -u, --username <username>           Username prefix for VM naming (required)"
    echo "  -c, --cp-image <version>           Control plane image version (optional)"
    echo "  -w, --worker-image <version>       Worker image version (optional)"
    echo "  -d, --terraform-dir <directory>    Terraform directory (default: ./terraform)"
    echo "  -h, --help                         Display this help message"
    echo ""
    echo "Example:"
    echo "  $0 -u john -c 2025.19.08190213 -w 2025.19.08185924"
    echo "  $0 --username john"
    exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--username)
            USERNAME="$2"
            shift 2
            ;;
        -c|--cp-image)
            CP_IMAGE_VERSION="$2"
            shift 2
            ;;
        -w|--worker-image)
            WORKER_IMAGE_VERSION="$2"
            shift 2
            ;;
        -d|--terraform-dir)
            TERRAFORM_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Validate required parameters
if [[ -z "$USERNAME" ]]; then
    echo "Error: Username is required"
    usage
fi

# Check if Azure CLI is logged in
echo "Checking Azure CLI authentication..."
if ! az account show &>/dev/null; then
    echo "Error: Azure CLI not logged in. Please run 'az login' first"
    exit 1
fi

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo "Error: Terraform is not installed. Please install Terraform first"
    exit 1
fi

# Create terraform directory if it doesn't exist
mkdir -p "$TERRAFORM_DIR"

# Change to terraform directory
cd "$TERRAFORM_DIR"

echo "Initializing Terraform..."
terraform init

echo "Planning Terraform deployment..."
terraform plan \
    -var="username=$USERNAME" \
    -var="cp_image_version=$CP_IMAGE_VERSION" \
    -var="worker_image_version=$WORKER_IMAGE_VERSION" \
    -out=tfplan

echo "Applying Terraform deployment..."
terraform apply tfplan

echo "Getting VM IP addresses..."
CP_IP=$(terraform output -raw control_plane_ip)
WORKER_IP=$(terraform output -raw worker_ip)

echo "=======>Both VMs created successfully!"
echo "Control Plane IP: $CP_IP"
echo "Worker IP: $WORKER_IP"

# Write IPs to a file for the Go application to read
cat > ../vm_ips.txt << EOF
CP_IP=$CP_IP
WORKER_IP=$WORKER_IP
EOF

echo "VM IPs written to vm_ips.txt"
