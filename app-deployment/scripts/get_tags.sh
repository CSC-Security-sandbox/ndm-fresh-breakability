#!/bin/bash

ACR_NAME="datamigratedev"

# Validate Azure CLI Installation
if ! command -v az > /dev/null 2>&1; then
    echo "[ERROR] Azure CLI is not installed. Please install Azure CLI and try again."
    echo ""
    exit 1
fi
echo "[INFO] Azure CLI is installed."
echo ""

# Azure & ACR Login
echo "------------------------------------------------------------"
echo "[INFO] Logging in to Azure..."
echo "------------------------------------------------------------"
az login --service-principal --username "$ARM_CLIENT_ID" \
             --password "$ARM_CLIENT_SECRET" \
             --tenant "$ARM_TENANT_ID"
if [ $? -ne 0 ]; then
    echo "[WARNING] Azure login failed. Attempting to log out and retry..."
    az logout
    az login --service-principal --username "$ARM_CLIENT_ID" \
             --password "$ARM_CLIENT_SECRET" \
             --tenant "$ARM_TENANT_ID"
    if [ $? -ne 0 ]; then
        echo "[ERROR] Azure login failed again. Exiting."
        echo ""
        exit 1
    fi
fi
echo "[INFO] Azure login successful."

# Define services and their images using a colon-delimited format
services=(
    "admin_service:ndm-admin-service"
    "config_service:ndm-config-service"
    "datamigrator_ui:ndm-datamigrator-ui"
    "db_writer_service:ndm-db-writer"
    "jobs_service:ndm-jobs-service"
    "reports_service:ndm-reports-service"
    "keycloak_customizations:ndm-keycloak-customizations"
)

# Function: Fetch Latest Commit-Hash Tag
get_latest_commit_tag() {
    local repo="$1"
    az acr repository show-tags --name "$ACR_NAME" \
        --repository "$repo" \
        --orderby time_desc \
        --output tsv | grep -v "latest" 2>/dev/null | head -n 1
}

# Output latest commit hash for all images in each service
echo "Outputting latest commit hashes for all images..."

# Collect tag lines
TAG_LINES=()
for service_entry in "${services[@]}"; do
    service="${service_entry%%:*}"
    repos="${service_entry#*:}"
    echo "[INFO] Repositories for service '$service': $repos"
    for repo in $repos; do
        latest_tag=$(get_latest_commit_tag "$repo")
        if [ -z "$latest_tag" ]; then
            echo "[ERROR] No commit-hash tag found for repository '$repo'."
        else
            echo "${service}_tag: \"$latest_tag\""
            TAG_LINES+=("${service}_tag: \"$latest_tag\"")
        fi
    done
done

VARS_YAML="app-deployment/ansible/control-plane/config/group_vars/vars.yaml"
{
  echo "# Microservices release tags of docker images"
  for tag in "${TAG_LINES[@]}"; do
    echo "$tag"
  done
} > "$VARS_YAML"

echo "[INFO] Wrote tags to $VARS_YAML"