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

# Check required environment variables
if [ -z "$AZ_USERNAME" ] || [ -z "$AZ_PASSWORD" ] || [ -z "$AZ_TENANT" ]; then
    echo "Please set the AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables"
    exit 1
else
    echo "AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set"
fi

if [ -z "$GITOPS_USER_GITHUB_TOKEN" ]; then
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
base_dir=$(realpath "$script_dir")
datamigrator_dir="$base_dir/app-deployment/datamigrator"
initial_build=false
images=()

# List of all services
services=( "admin-service" "config-service" "datamigrator-ui" "db-writer" "jobs-service" "reports-service" "db-migrations" "support-service")

echo -e "\nFetching multipass IP for the registry..."
multipass_output=$(multipass list)
ip_address=$(echo "$multipass_output" | awk '/datamigrator-cp/ {print $3}')
repo_url="${ip_address}:32000"
echo -e "\nUsing remote registry: $repo_url"

mkdir -p "$datamigrator_dir"

echo -e "\nStarting build process for services: ${services[*]}"

# Automatically generate build version: e.g., july_19_1500
build_version=$(date +"$(date +%B | tr '[:upper:]' '[:lower:]')_%-d_%H%M")

for service in "${services[@]}"; do
    service_name=$service
    service_version=$build_version

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
        images+=("$image_tag")
        echo -e "Added $image_tag to the list for TAR saving"
    else
        echo -e "Pushing image: $image_tag"
        docker push "$image_tag"
    fi

done

# Save all images if it's an initial build
if $initial_build; then
    tar_file="$datamigrator_dir/images_${build_version}.tar"
    echo -e "\nSaving all Docker images to $tar_file..."
    for img in "${images[@]}"; do
        echo -e "Including image: $img"
    done
    docker save -o "$tar_file" "${images[@]}"
    echo -e "Images saved successfully in $tar_file"
fi

echo -e "\nBuild process completed!"

echo -e "\nRunning Ansible playbook with image tags: ${build_version}..."

cd app-deployment

ansible-playbook -i ./ansible/control-plane/config/inventory.yaml ./ansible/control-plane/playbooks/helm-upgrade.yaml -e local_cluster=true -e "
  datamigrator_ui_tag=${build_version}
  config_service_tag=${build_version}
  db_writer_service_tag=${build_version}
  jobs_service_tag=${build_version}
  reports_service_tag=${build_version}
  admin_service_tag=${build_version}
  keycloak_customizations_tag=latest
  db_migrations_tag=${build_version}
  support_service_tag=${build_version}
"

cd ..

echo -e "\n✅ Ansible playbook execution completed and returned to base directory."
