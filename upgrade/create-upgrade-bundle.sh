#!/bin/bash
set -e  # Exit on any error

# Define log file
LOG_FILE="$PWD/upgrade_bundle_$(date +%Y%m%d_%H%M%S).log"

# Function to log messages to both console and file
log_message() {
    echo "$@" | tee -a "$LOG_FILE"
}

log_message "Starting to create upgrade bundle"
log_message "Log file: $LOG_FILE"


# Get the release version from the first argument
if [ $# -ne 1 ]; then
    log_message "Error: Incorrect number of arguments."
    log_message "Usage: $0 release-version"
    log_message "Example: $0 2025.19.08-preview"
    exit 1
fi

RELEASE_VERSION="$1"
# Check if directory exists and remove it
if [ -d "$RELEASE_VERSION" ]; then
    log_message "Directory $RELEASE_VERSION already exists. Removing it..."
    if ! rm -rf "$RELEASE_VERSION"; then
        log_message "Error: Failed to remove existing directory $RELEASE_VERSION"
        exit 1
    fi
fi

# Create new directory
if ! mkdir "$RELEASE_VERSION"; then
    log_message "Error: Failed to create directory $RELEASE_VERSION"
    exit 1
fi
if ! cd "$RELEASE_VERSION"; then
    log_message "Error: Failed to change to directory $RELEASE_VERSION"
    exit 1
fi

DOCKER_IMAGES_TAR_URL="https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/releases/$RELEASE_VERSION/docker/datamigrator-$RELEASE_VERSION.tar"
HELM_TGZ_FILE_URL="https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/releases/$RELEASE_VERSION/helm/datamigrator-$RELEASE_VERSION.tgz"
log_message "Using release version: $RELEASE_VERSION"
log_message "Using Docker images tar URL: $DOCKER_IMAGES_TAR_URL"
log_message "Using Helm tgz file URL: $HELM_TGZ_FILE_URL"


log_message "Downloading datamigrator image from artifactory... Please wait.. it takes time as the file size is large aroung 8 GB"
curl -LO "https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/releases/$RELEASE_VERSION/docker/datamigrator-$RELEASE_VERSION.tar" 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "datamigrator-$RELEASE_VERSION.tar" ]; then
    log_message "Error: Failed to download datamigrator-$RELEASE_VERSION.tar"
    exit 1
fi

log_message "Successfully downloaded datamigrator-$RELEASE_VERSION.tar"

log_message "Downloading helm chart from artifactory..."
curl -LO "https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/releases/$RELEASE_VERSION/helm/datamigrator-$RELEASE_VERSION.tgz" 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "datamigrator-$RELEASE_VERSION.tgz" ]; then
    log_message "Error: Failed to download datamigrator-$RELEASE_VERSION.tgz"
    exit 1
fi

log_message "Successfully downloaded datamigrator-$RELEASE_VERSION.tgz"

log_message "Copying upgrade.sh script..."
cp ../upgrade.sh . 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "upgrade.sh" ]; then
    log_message "Error: Failed to copy upgrade.sh"
    exit 1
fi

log_message "Successfully copied upgrade.sh"

log_message "Creating checksum file..."
sha256sum datamigrator-$RELEASE_VERSION.tar datamigrator-$RELEASE_VERSION.tgz upgrade.sh > checksums.sha256 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "checksums.sha256" ]; then
    log_message "Error: Failed to create checksums.sha256"
    exit 1
fi

log_message "Successfully created checksums.sha256"
log_message "Checksum contents:"
# Create the upgrade bundle zip
log_message "Creating upgrade bundle zip..."
cd ..
zip -r "$RELEASE_VERSION.zip" "$RELEASE_VERSION/" 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "$RELEASE_VERSION.zip" ]; then
    log_message "Error: Failed to create $RELEASE_VERSION.zip"
    exit 1
fi

log_message "Successfully created upgrade bundle: $RELEASE_VERSION.zip"
log_message "Upgrade bundle creation completed successfully"



