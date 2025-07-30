#!/bin/bash

set -euo pipefail

ARTIFACTORY_BASE="https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/manifests"
ACR_NAME="datamigratedev"
TAR_PREFIX="datamigrator"
VERSION=$1
REF_TYPE=$2
REF_NAME=$3

ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    PLATFORM="linux/amd64"
elif [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
    PLATFORM="linux/arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi
echo "Detected architecture: $ARCH, using platform: $PLATFORM"

# Explicit mapping: artifactory_name:vars_tag:vars_branch:acr_image_name
services=(
    "admin-service:admin_service_tag:admin_service_branch:ndm-admin-service"
    "config-service:config_service_tag:config_service_branch:ndm-config-service"
    "datamigrator-ui:datamigrator_ui_tag:datamigrator_ui_branch:ndm-datamigrator-ui"
    "db-writer:db_writer_service_tag:db_writer_service_branch:ndm-db-writer"
    "db-migrations:db_migrations_tag:db_migrations_branch:ndm-db-migrations"
    "jobs-service:jobs_service_tag:jobs_service_branch:ndm-jobs-service"
    "reports-service:reports_service_tag:reports_service_branch:ndm-reports-service"
    "keycloak-customizations:keycloak_customizations_tag:keycloak_customizations_branch:ndm-keycloak-customizations"
)

echo "Outputting tags from Artifactory for all images..."

TAG_LINES=()
IMAGES=()

for mapping in "${services[@]}"; do
    IFS=":" read -r artifactory_service tag_var branch_var acr_image_name <<< "$mapping"

    # Environment variable name is the uppercase of the tag_var
    env_tag_var="$(echo "$tag_var" | tr '[:lower:]' '[:upper:]')"
    env_branch_var="$(echo "$branch_var" | tr '[:lower:]' '[:upper:]')"
    tag="${!env_tag_var:-}"
    branch="${!env_branch_var:-}"

    if [[ "$tag" == "latest" ]]; then
        if [[ "$REF_TYPE" == "releases" ]]; then
            latest_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/latest.json"
        else
            latest_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${branch}/latest.json"
        fi
        echo "[INFO] Fetching $latest_url"
        json=$(curl -sf "$latest_url")
        image_tag=$(echo "$json" | jq -r '.image_tag')
    else
        short_sha="${tag:0:7}"
        if [[ "$REF_TYPE" == "releases" ]]; then
            meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${REF_NAME}/${short_sha}/metadata.json"
        else
            meta_url="${ARTIFACTORY_BASE}/services/${artifactory_service}/${REF_TYPE}/${branch}/${short_sha}/metadata.json"
        fi
        echo "[INFO] Fetching $meta_url"
        json=$(curl -sf "$meta_url")
        image_tag=$(echo "$json" | jq -r '.image_tag')
        if [[ "$image_tag" != "$tag" ]]; then
            echo "[WARNING] image_tag in metadata.json ($image_tag) does not match requested custom tag ($tag) for $artifactory_service"
        fi
    fi

    if [[ -z "$image_tag" || "$image_tag" == "null" ]]; then
        echo "[ERROR] Failed to extract image tag for $artifactory_service"
        exit 1
    fi

    echo "[INFO] $tag_var -> tag: $VERSION"
    TAG_LINES+=("$tag_var: \"$VERSION\"")

    # Compose the full ACR image name using the explicit mapping
    full_image_name="${ACR_NAME}.azurecr.io/${acr_image_name}:${image_tag}"
    IMAGES+=("$full_image_name")
done

VARS_YAML="app-deployment/ansible/control-plane/config/group_vars/vars.yaml"
{
  echo "# Microservices release tags of docker images"
  for tg in "${TAG_LINES[@]}"; do
    echo "$tg"
  done
} > "$VARS_YAML"

echo "[INFO] Wrote tags to $VARS_YAML"

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

echo "------------------------------------------------------------"
echo "[INFO] Logging in to Azure Container Registry ($ACR_NAME)..."
echo "------------------------------------------------------------"
az acr login --name "$ACR_NAME"
if [ $? -ne 0 ]; then
    echo "[ERROR] ACR login failed. Exiting."
    exit 1
fi
echo "[INFO] ACR login successful."

# Pull, retag, and save images
echo "------------------------------------------------------------"
echo "[INFO] Pulling images, retagging with version (${VERSION}), and preparing for tarball..."
echo "------------------------------------------------------------"
LOCAL_IMAGES=()
for IMAGE in "${IMAGES[@]}"; do
    echo "[INFO] Pulling $IMAGE"
    docker pull --platform $PLATFORM "$IMAGE"

    # Strip ACR prefix and use new version tag
    IMAGE_WITHOUT_REGISTRY=$(echo "$IMAGE" | sed "s|^${ACR_NAME}\.azurecr\.io/||")
    IMAGE_BASE=$(echo "$IMAGE_WITHOUT_REGISTRY" | cut -d: -f1)
    NEW_TAG="${IMAGE_BASE}:${VERSION}"

    echo "[INFO] Retagging $IMAGE as $NEW_TAG"
    docker tag "$IMAGE" "$NEW_TAG"
    LOCAL_IMAGES+=("$NEW_TAG")
done

# Output the list of images to be saved
echo "------------------------------------------------------------"
echo "[INFO] List of images to be saved to tarball:"
echo "------------------------------------------------------------"
for IMAGE in "${LOCAL_IMAGES[@]}"; do
    echo "$IMAGE"
done

# Define the artifacts directory relative to the script location
ARTIFACT_DIR="$(dirname "$0")/../artifacts"
mkdir -p "$ARTIFACT_DIR"

TAR_NAME="${TAR_PREFIX}-${VERSION}.tar"
TAR_PATH="${ARTIFACT_DIR}/${TAR_NAME}"

echo "------------------------------------------------------------"
echo "[INFO] Saving images to $TAR_PATH..."
echo "------------------------------------------------------------"
docker save "${LOCAL_IMAGES[@]}" -o "$TAR_PATH"
echo "[INFO] Docker images saved to $TAR_PATH"