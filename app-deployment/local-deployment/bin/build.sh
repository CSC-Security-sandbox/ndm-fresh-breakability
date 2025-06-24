#!/bin/bash
set -e  # Exit on any error

# Detect system architecture
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

# check if AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set or not
if [ -z "$AZ_USERNAME" ] || [ -z "$AZ_PASSWORD" ] || [ -z "$AZ_TENANT" ]
then
    echo "Please set the AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables"
    exit 1
else
    echo "AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set"
fi

# check if GITOPS_USER_GITHUB_TOKEN environment variable is set or not
if [ -z "$GITOPS_USER_GITHUB_TOKEN" ]
then
    echo "Please set the GITOPS_USER_GITHUB_TOKEN environment variable"
    exit 1
else
    echo "GITOPS_USER_GITHUB_TOKEN environment variable is set"
fi
 
echo -e "\nLogging in to Azure..."
az login --service-principal \
  --username  "${AZ_USERNAME}" \
  --password "${AZ_PASSWORD}" \
  --tenant "${AZ_TENANT}"

echo -e "\nLogging in to Azure Container Registry..."
az acr login --name datamigratedev

script_dir=$(dirname "$0")
base_dir=$(realpath "$script_dir/../../..")
datamigrator_dir="$base_dir/app-deployment/datamigrator"
initial_build=false
images=()

# List of all services (defined once)
services=( "keycloak-customizations" "admin-service" "config-service" "datamigrator-ui" "db-writer" "jobs-service" "reports-service" "db-migrations" )

# Check if "--initial-build" flag is passed
if [[ "$1" == "--initial-build" ]]; then
    initial_build=true
    tar_file="${datamigrator_dir}/datamigrator.tar"
    echo -e "\nInitial build detected. Images will be saved to TAR."
    rm -f "$tar_file"  # Remove any old tar file
elif [ -n "$1" ]; then
    # If a specific service is passed, override services array
    services=( "$1" )
    echo -e "\nBuilding only the specified service: $1"
fi

# Determine repository URL
if $initial_build; then
    repo_url="localhost:32000"
    echo -e "\nUsing local registry: $repo_url"
else
    echo -e "\nFetching multipass IP for the registry..."
    multipass_output=$(multipass list)
    ip_address=$(echo "$multipass_output" | awk '/datamigrator-cp/ {print $3}')
    repo_url="${ip_address}:32000"
    echo -e "\nUsing remote registry: $repo_url"
fi

mkdir -p "$datamigrator_dir"

echo -e "\nStarting build process for services: ${services[*]}"

# Build images (push for normal builds, save for initial-build builds)
for service in "${services[@]}"; do
    service_name=$service
    service_version=${2:-latest}

    # Set Dockerfile and context paths
    if [ "$service_name" == "db-migrations" ]; then
        docker_file_path="$base_dir/liquibase/Dockerfile"
        build_context="$base_dir/liquibase"
    else
        docker_file_path="$base_dir/services/${service_name}/Dockerfile"
        build_context="$base_dir/services/${service_name}"
    fi

    image_tag="${repo_url}/ndm-${service_name}:${service_version}"
    
    echo -e "\nBuilding service image: $image_tag"
    docker build --platform $PLATFORM --secret id=git_token,env=GITOPS_USER_GITHUB_TOKEN \
        -t "$image_tag" \
        -f "$docker_file_path" "$build_context"

    if $initial_build; then
        images+=("$image_tag")  # Store image name
        echo -e "Added $image_tag to the list for TAR saving"
    else
        echo -e "Pushing image: $image_tag"
        docker push "$image_tag"
    fi

done

# Save all images in one tar file if initial build
if $initial_build; then
    echo -e "\nSaving all Docker images to $tar_file..."
    for img in "${images[@]}"; do
        echo -e "Including image: $img"
    done
    docker save -o "$tar_file" "${images[@]}"
    echo -e "Images saved successfully in $tar_file"
fi

echo -e "\nBuild process completed!"