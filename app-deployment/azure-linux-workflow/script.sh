#!/bin/bash

# Prompt for arguments
read -p "Enter control plane image version (leave blank for latest): " CP_IMAGE_VERSION
read -p "Enter worker image version (leave blank for latest): " WORKER_IMAGE_VERSION
read -p "Enter number of worker VMs (default 1): " WORKER_COUNT

# Set defaults if not provided
CP_IMAGE_VERSION=${CP_IMAGE_VERSION:-""}
WORKER_IMAGE_VERSION=${WORKER_IMAGE_VERSION:-""}
WORKER_COUNT=${WORKER_COUNT:-1}

echo "Using:"
echo "  Control Plane Image Version: '${CP_IMAGE_VERSION:-latest}'"
echo "  Worker Image Version: '${WORKER_IMAGE_VERSION:-latest}'"
echo "  Number of Workers: $WORKER_COUNT"
echo

# Deploy Control Plane
cd ./control_plane || exit 1
echo "Deploying Control Plane..."
terraform init -input=false
if [ -z "$CP_IMAGE_VERSION" ]; then
    terraform apply -auto-approve
else
    terraform apply -auto-approve -var="image_version=$CP_IMAGE_VERSION"
fi

CP_IP=$(terraform output -raw vm_private_ip)
echo "Control Plane Private IP: $CP_IP"
cd ..

# Deploy Workers
cd ./worker || exit 1
echo "Deploying $WORKER_COUNT Worker(s)..."
terraform init -input=false
TF_ARGS=""
[ -n "$WORKER_IMAGE_VERSION" ] && TF_ARGS="$TF_ARGS -var=image_version=$WORKER_IMAGE_VERSION"
[ -n "$WORKER_COUNT" ] && TF_ARGS="$TF_ARGS -var=worker_count=$WORKER_COUNT"

eval terraform apply -auto-approve $TF_ARGS

WORKER_IPS=$(terraform output -json worker_private_ips | jq -r '.[]')
echo "Worker Private IPs:"
echo "$WORKER_IPS"
cd ..

echo "Deployment complete! "
