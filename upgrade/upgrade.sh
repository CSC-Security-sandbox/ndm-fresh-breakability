#!/bin/bash
set -e  # Exit on any error

# Define log file
LOG_FILE="$PWD/upgrade_$(date +%Y%m%d_%H%M%S).log"

# Function to log messages to both console and file
log_message() {
    echo "$@" | tee -a "$LOG_FILE"
}

log_message "Starting upgrade script..."
log_message "Log file: $LOG_FILE"

# Get input files from command line arguments
if [ $# -ne 3 ]; then
    log_message "Error: Incorrect number of arguments."
    log_message "Usage: $0 <check-sum-file> <docker-tar-file> <helm-tgz-file>"
    log_message "Example: $0 checksums.sha256 2025.08.17-preview.tar 2025.08.17-preview.tgz"
    exit 1
fi

# Update argument parsing
CHECKSUM_FILE="$1"
DOCKER_TAR_FILE="$2"
HELM_TGZ_FILE="$3"

# Validate input files exist
if [ ! -f "$DOCKER_TAR_FILE" ]; then
    log_message "Error: Docker tar file '$DOCKER_TAR_FILE' not found."
    exit 1
fi

if [ ! -f "$HELM_TGZ_FILE" ]; then
    log_message "Error: Helm tgz file '$HELM_TGZ_FILE' not found."
    exit 1
fi

# Validate file extensions
if [[ ! "$DOCKER_TAR_FILE" =~ \.tar$ ]]; then
    log_message "Error: Docker file must have .tar extension."
    exit 1
fi

if [[ ! "$HELM_TGZ_FILE" =~ \.tgz$ ]]; then
    log_message "Error: Helm file must have .tgz extension."
    exit 1
fi

log_message "Using Docker tar file: $DOCKER_TAR_FILE"
log_message "Using Helm tgz file: $HELM_TGZ_FILE"

# Function to validate checksums
validate_checksums() {
    log_message "Validating checksums..."
    
    # Check if checksum file exists
    if [ ! -f "$CHECKSUM_FILE" ]; then
        log_message "Error: Checksum file '$CHECKSUM_FILE' not found."
        exit 1
    fi
    
    # Create temporary checksum file with current file paths
    temp_checksum_file=$(mktemp)
    if [ -z "$temp_checksum_file" ] || [ ! -f "$temp_checksum_file" ]; then
        log_message "Error: Failed to create temporary checksum file."
        exit 1
    fi
    
    # Extract expected checksums and map to current file names
    while read -r line; do
        # Skip empty lines and comments
        [[ -z "$line" || "$line" =~ ^# ]] && continue
        
        # Parse checksum and filename (handle multiple spaces)
        expected_hash=$(echo "$line" | awk '{print $1}')
        original_file=$(echo "$line" | awk '{print $2}')
        
        # Skip if parsing failed
        [[ -z "$expected_hash" || -z "$original_file" ]] && continue
        
        # Determine which file this checksum is for based on extension
        if [[ "$original_file" == *.tar ]]; then
            echo "$expected_hash  $DOCKER_TAR_FILE" >> "$temp_checksum_file"
        elif [[ "$original_file" == *.tgz ]]; then
            echo "$expected_hash  $HELM_TGZ_FILE" >> "$temp_checksum_file"
        elif [[ "$original_file" == "upgrade.sh" ]]; then
            echo "$expected_hash  $0" >> "$temp_checksum_file"
        fi
    done < "$CHECKSUM_FILE"
    
    # Validate checksums
    if ! sha256sum -c "$temp_checksum_file"; then
        log_message "Error: Checksum validation failed!"
        rm -f "$temp_checksum_file"
        exit 1
    fi
    
    log_message "All checksums validated successfully."
    rm -f "$temp_checksum_file"
}



# Validate checksum file exists
if [ ! -f "$CHECKSUM_FILE" ]; then
    log_message "Error: Checksum file '$CHECKSUM_FILE' not found."
    exit 1
fi

log_message "Using checksum file: $CHECKSUM_FILE"

# Validate checksums before proceeding
validate_checksums

# Function to get image versions of datamigrator services
get_service_image_versions() {
    log_message "Retrieving image versions for datamigrator services..."

    # Define the services to check
    services=("admin-service" "config-service" "datamigrator-ui" "db-writer" "jobs-service" "reports-service" "support-service")

    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        log_message "Error: kubectl command not found. Please install kubectl first."
        return 1
    fi

    # Check if we can access the datamigrator namespace
    if ! kubectl get namespace datamigrator &> /dev/null; then
        log_message "Error: Cannot access datamigrator namespace. Please check your kubernetes configuration."
        return 1
    fi

    log_message "############# Current image versions in datamigrator namespace ##############"
    log_message "================================================"

    # Get image version for each service
    for service in "${services[@]}"; do
        # Get pods for the service
        pod_info=$(kubectl get pods -n datamigrator -l app="$service" -o jsonpath='{.items[*].spec.containers[*].image}' 2>/dev/null || echo "")

        if [ -z "$pod_info" ]; then
            # Try without label selector - match by pod name prefix
            pod_info=$(kubectl get pods -n datamigrator -o json | jq -r ".items[] | select(.metadata.name | startswith(\"$service\")) | .spec.containers[].image" 2>/dev/null || echo "")
        fi

        # Extract only ndm images from the pod info
        ndm_image=""
        if [ -n "$pod_info" ]; then
            # Split the images and filter for ndm
            for image in $pod_info; do
                if [[ "$image" == *ndm* ]]; then
                    ndm_image="$image"
                    break
                fi
            done
        fi

        if [ -n "$ndm_image" ]; then
            log_message "$service: $ndm_image"
        else
            log_message "$service: No ndm image found or service not running"
        fi
    done
    log_message "================================================"
}

# Call the function to display current image versions
get_service_image_versions

# Check if files exist in current working directory
log_message "Checking for required files in current directory..."

# Check for .tar file
if ! ls *.tar >/dev/null 2>&1; then
    log_message "Error: No .tar file found in current directory."
    exit 1
fi

# Check for .tgz file
if ! ls *.tgz >/dev/null 2>&1; then
    log_message "Error: No .tgz file found in current directory."
    exit 1
fi

# Count the number of .tar and .tgz files
tar_count=$(ls *.tar 2>/dev/null | wc -l)
tgz_count=$(ls *.tgz 2>/dev/null | wc -l)

if [ "$tar_count" -gt 1 ]; then
    log_message "Error: Multiple .tar files found in current directory. Please ensure only one .tar file is present."
    exit 1
fi

if [ "$tgz_count" -gt 1 ]; then
    log_message "Error: Multiple .tgz files found in current directory. Please ensure only one .tgz file is present."
    exit 1
fi

log_message "Required files found in current directory."

# upload the imges to microk8s registry
log_message "Uploading images to microk8s registry..."
if ! microk8s ctr images import "$DOCKER_TAR_FILE"; then
    log_message "Error: Failed to import Docker images from $DOCKER_TAR_FILE."
    exit 1
fi 
log_message "Docker images imported successfully."


# Run helm upgrade
log_message "Running helm upgrade..."
if ! helm upgrade --install datamigrator -n datamigrator "$HELM_TGZ_FILE"; then
    log_message "Error: Failed to run helm upgrade."
    exit 1
fi

log_message "Waiting for 2 minutes for services to stabilize..."
sleep 120


log_message "Helm upgrade completed successfully."
# Display success message
log_message ""
log_message "############# Upgrade completed successfully! ##############"
log_message ""
log_message "Checking new image versions after upgrade..."
log_message ""
get_service_image_versions
