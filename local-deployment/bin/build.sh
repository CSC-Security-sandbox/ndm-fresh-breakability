#!/bin/bash
set -e  # Exit on any error

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
services=( "keycloak-customizations" "admin-service" "config-service" "data-migrate-ui" "db-writer" "file-service" "jobs-service" "reports-service" )

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

    # Define Dockerfile name
    docker_file_name="Dockerfile"
    if [[ "$service_name" == "keycloak-customizations" ]]; then
        docker_file_name="dockerfile-microk8s"
    fi

    image_tag="${repo_url}/${service_name}:${service_version}"
    
    echo -e "\nBuilding service image: $image_tag"
    docker build --secret id=git_token,env=GITOPS_USER_GITHUB_TOKEN \
        -t "$image_tag" \
        -f "${base_dir}/${service_name}/${docker_file_name}" "${base_dir}/${service_name}"

    if $initial_build; then
        images+=("$image_tag")  # Store image name
        echo -e "Added $image_tag to the list for TAR saving"
    else
        echo -e "Pushing image: $image_tag"
        docker push "$image_tag"
    fi

    # Build Liquibase migrations image (except for keycloak-customizations, file-service, and data-migrate-ui)
    if [[ "$service_name" != "keycloak-customizations" && "$service_name" != "file-service" && "$service_name" != "data-migrate-ui" ]]; then
        migration_image_tag="${repo_url}/${service_name}-migrations:${service_version}"
        
        echo -e "\nBuilding migrations image: $migration_image_tag"
        docker build -t "$migration_image_tag" \
            -f "${base_dir}/${service_name}/liquibase/Dockerfile" "${base_dir}/${service_name}/liquibase"

        if $initial_build; then
            images+=("$migration_image_tag")  # Store image name
            echo -e "Added $migration_image_tag to the list for TAR saving"
        else
            echo -e "Pushing migrations image: $migration_image_tag"
            docker push "$migration_image_tag"
        fi
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
