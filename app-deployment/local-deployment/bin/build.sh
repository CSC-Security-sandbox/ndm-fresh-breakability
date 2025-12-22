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
clean_build=false
images=()

# List of all services (defined once)
all_services=( "keycloak-customizations" "admin-service" "config-service" "datamigrator-ui" "db-writer" "jobs-service" "reports-service" "db-migrations" "support-service" )

# Usage function
usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] [SERVICE] [VERSION]

Build Docker images for NDM services.

OPTIONS:
    --initial-build     Save images to TAR file instead of pushing to registry
    --version VERSION   Specify image version tag (default: latest)
    --clean             Remove built Docker images and TAR files before building
    --help, -h          Show this help message

ARGUMENTS:
    SERVICE             Build only the specified service (optional, default: all services)
    VERSION             Image version tag (optional, default: latest)

EXAMPLES:
    # Build all services and push to registry
    ./build.sh

    # Build specific service (backward compatible)
    ./build.sh admin-service

    # Build specific service with version (backward compatible)
    ./build.sh admin-service v1.2.3

    # Initial build (save to TAR)
    ./build.sh --initial-build

    # Build specific service for initial deployment
    ./build.sh --initial-build admin-service

    # Build with version flag
    ./build.sh --version v1.2.3 admin-service

    # Clean and rebuild
    ./build.sh --clean

    # Clean and rebuild specific service
    ./build.sh --clean admin-service

AVAILABLE SERVICES:
    ${all_services[*]}

BACKWARD COMPATIBILITY:
    Legacy usage patterns are fully supported:
    - ./build.sh --initial-build
    - ./build.sh service-name
    - ./build.sh service-name version

EOF
    exit 0
}

# Default values
service_version="latest"
specific_service=""
parsed_args=()

# Parse arguments - handle both new flags and old positional style
while [[ $# -gt 0 ]]; do
    case $1 in
        --initial-build)
            initial_build=true
            shift
            ;;
        --version)
            if [ -z "$2" ] || [[ "$2" == --* ]]; then
                echo "Error: --version requires a value"
                exit 1
            fi
            service_version="$2"
            shift 2
            ;;
        --clean)
            clean_build=true
            shift
            ;;
        --help|-h)
            usage
            ;;
        -*)
            echo "Error: Unknown option $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            # Collect positional arguments
            parsed_args+=("$1")
            shift
            ;;
    esac
done

# Process positional arguments (backward compatible)
if [ ${#parsed_args[@]} -gt 0 ]; then
    specific_service="${parsed_args[0]}"
    
    # Validate service exists
    if [[ ! " ${all_services[@]} " =~ " ${specific_service} " ]]; then
        echo "Error: Invalid service name: $specific_service"
        echo "Available services: ${all_services[*]}"
        exit 1
    fi
    
    echo -e "\nBuilding only the specified service: $specific_service"
fi

# Second positional arg is version (if not already set via --version flag)
if [ ${#parsed_args[@]} -gt 1 ] && [ "$service_version" == "latest" ]; then
    service_version="${parsed_args[1]}"
    echo -e "Using version: $service_version"
fi

# Warn if too many positional arguments
if [ ${#parsed_args[@]} -gt 2 ]; then
    echo "Warning: Extra arguments ignored: ${parsed_args[@]:2}"
fi

# Set services array based on specific_service
if [ -n "$specific_service" ]; then
    services=( "$specific_service" )
else
    services=( "${all_services[@]}" )
fi

# Clean existing images and TAR files if requested
if $clean_build; then
    echo -e "\n🧹 Cleaning existing Docker images and TAR files..."
    
    # Remove TAR file if exists
    tar_file="${datamigrator_dir}/datamigrator.tar"
    if [ -f "$tar_file" ]; then
        echo "Removing TAR file: $tar_file"
        rm -f "$tar_file"
    fi
    
    # Remove Docker images for services being built
    for service in "${services[@]}"; do
        # Get all image tags that match this service
        matching_images=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep "ndm-${service}" || true)
        
        if [ -n "$matching_images" ]; then
            echo "Removing images for service: $service"
            echo "$matching_images" | while read image; do
                echo "  - $image"
                docker rmi "$image" 2>/dev/null || echo "    (already removed or in use)"
            done
        fi
    done
    
    echo "✅ Clean completed"
    
    # If only --clean was specified (no other flags or services), exit after cleaning
    if ! $initial_build && [ -z "$specific_service" ] && [ "$service_version" == "latest" ]; then
        echo -e "\nClean-only operation completed. Exiting without building."
        exit 0
    fi
fi

# Setup initial build if needed
if $initial_build; then
    tar_file="${datamigrator_dir}/datamigrator.tar"
    echo -e "\nInitial build detected. Images will be saved to TAR."
    rm -f "$tar_file"  # Remove any old tar file
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
    # service_version already set from argument parsing

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