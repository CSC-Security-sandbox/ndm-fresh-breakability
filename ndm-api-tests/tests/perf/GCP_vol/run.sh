#!/bin/bash

# Log file creation
LOG_FILE="netapp_volume_deploy_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# Start timer
SECONDS=0


echo "🔵 ===== GCP NETAPP VOLUME MANAGEMENT SCRIPT ===== 🔵"

# ===== ENHANCED CLEANUP SECTION =====
echo "🧹 Cleaning up previous Terraform state and cache..."

# Remove all Terraform state files
rm -f terraform.tfstate terraform.tfstate.backup
rm -f .terraform.lock.hcl
rm -rf .terraform/

# Clear any existing Terraform variables
unset $(env | grep '^TF_VAR_' | cut -d= -f1)

# Remove any existing tfvars files
rm -f terraform.tfvars
rm -f *.auto.tfvars

# Clear Terraform backend cache if exists
rm -rf .terraform.d/

echo "✅ Terraform cleanup completed"

# Clean up previous state
rm -f terraform.tfstate terraform.tfstate.backup

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi

# Default values based on your existing NetApp setup
PROJECT_ID="app-microservices-cm"
DEFAULT_REGION="us-east4"
DEFAULT_STORAGE_POOL="sp-0727"  # Your existing NetApp storage pool
DEFAULT_VOLUME_PREFIX="vol"
DEFAULT_SHARE_PREFIX="share"
DEFAULT_VOLUME_COUNT=1
DEFAULT_VOLUME_SIZE=4096 # in GiB
DEFAULT_CLEANUP=false
DEFAULT_USE_EXISTING=false  # Add this new parameter

# DEFAULT_ENVIRONMENT="dev"
DEFAULT_NETWORK="appmicro-vpc1"
DEFAULT_ALLOWED_CLIENTS="0.0.0.0/0"
DEFAULT_ACCESS_TYPE="READ_WRITE"
DEFAULT_ROOT_ACCESS="true"

echo ""
echo "📋 Current Configuration:"
echo "Project ID: $PROJECT_ID"
echo "Default Region: $DEFAULT_REGION"
echo "Default Network: $DEFAULT_NETWORK"
echo ""


echo ""

# User prompts for volume configuration
read -p "Enter storage pool name [$DEFAULT_STORAGE_POOL]: " STORAGE_POOL_NAME
STORAGE_POOL_NAME=${STORAGE_POOL_NAME:-$DEFAULT_STORAGE_POOL}

echo "🔍 Checking specified storage pool..."

# Get basic storage pool information
POOL_BASIC=$(gcloud netapp storage-pools describe $STORAGE_POOL_NAME \
    --location=$DEFAULT_REGION \
    --project=$PROJECT_ID \
    --format="value(state,capacityGib)" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$POOL_BASIC" ]; then
    IFS=$'\t' read -r POOL_STATE POOL_CAPACITY <<< "$POOL_BASIC"
    
    echo "📋 Current volumes in storage pool '$STORAGE_POOL_NAME':"
    VOLUME_LIST=$(gcloud netapp volumes list \
        --location=$DEFAULT_REGION \
        --project=$PROJECT_ID \
        --filter="storagePool~'$STORAGE_POOL_NAME'" \
        --format="table(name,capacityGib,state)" 2>/dev/null)
    
    if [ -n "$VOLUME_LIST" ]; then
        echo "$VOLUME_LIST"
        
        # Calculate actual allocated capacity from volumes (this is more reliable)
        POOL_ALLOCATED=$(gcloud netapp volumes list \
            --location=$DEFAULT_REGION \
            --project=$PROJECT_ID \
            --filter="storagePool~'$STORAGE_POOL_NAME'" \
            --format="value(capacityGib)" 2>/dev/null | \
            awk '{sum += $1} END {print sum+0}')
        
        # Count volumes
        POOL_VOLUMES=$(gcloud netapp volumes list \
            --location=$DEFAULT_REGION \
            --project=$PROJECT_ID \
            --filter="storagePool~'$STORAGE_POOL_NAME'" \
            --format="value(name)" 2>/dev/null | wc -l)
    else
        echo "   No volumes found in this storage pool"
        POOL_ALLOCATED=0
        POOL_VOLUMES=0
    fi


    # Add option to use existing volumes
    echo ""
    echo "📦 VOLUME CONFIGURATION OPTIONS:"
    echo "1) Create new volumes"
    echo "2) Use existing volumes"
    read -p "Choose option (1/2) [1]: " VOLUME_OPTION
    VOLUME_OPTION=${VOLUME_OPTION:-1}

    
    AVAILABLE_CAPACITY=$((POOL_CAPACITY - POOL_ALLOCATED))
    
    echo ""
    echo "✅ Storage Pool Found: $STORAGE_POOL_NAME"
    echo "   State: $POOL_STATE"
    echo "   Total Capacity: ${POOL_CAPACITY}GiB"
    echo "   Allocated: ${POOL_ALLOCATED}GiB (calculated from volumes)"
    echo "   Available: ${AVAILABLE_CAPACITY}GiB"
    echo "   Current Volumes: $POOL_VOLUMES"
else
    echo "❌ Storage pool $STORAGE_POOL_NAME not found or query failed!"
    echo "Let me try to find available storage pools..."
    
    echo "Available storage pools in region $DEFAULT_REGION:"
    gcloud netapp storage-pools list \
        --location=$DEFAULT_REGION \
        --project=$PROJECT_ID \
        --format="table(name,state,capacityGib,volumeCount)"
    
    exit 1
fi

// ...existing code...

if [ "$VOLUME_OPTION" = "2" ]; then
    echo ""
    echo "📋 Using existing volumes. Available volumes:"
    gcloud netapp volumes list \
        --location=$DEFAULT_REGION \
        --project=$PROJECT_ID \
        --filter="storagePool~'$STORAGE_POOL_NAME'" \
        --format="table(name,shareName,capacityGib,state,mountOptions[].ipAddress,mountOptions[].exportPath)"
    
    read -p "Enter volume prefix to use: " VOLUME_PREFIX
    SHARE_PREFIX=$VOLUME_PREFIX
    
    # Validate that volumes with this prefix exist
    MATCHING_VOLUMES=$(gcloud netapp volumes list \
        --location=$DEFAULT_REGION \
        --project=$PROJECT_ID \
        --filter="storagePool~'$STORAGE_POOL_NAME' AND name~'$VOLUME_PREFIX.*'" \
        --format="value(name)" 2>/dev/null)
    
    if [ -z "$MATCHING_VOLUMES" ]; then
        echo "❌ No volumes found matching prefix '$VOLUME_PREFIX'"
        exit 1
    fi
    
    VOLUME_COUNT=$(echo "$MATCHING_VOLUMES" | wc -l)
    echo "✅ Found $VOLUME_COUNT existing volume(s) matching '$VOLUME_PREFIX'"
    
    echo ""
    echo "✅ Using existing volumes with prefix '$VOLUME_PREFIX'"
    echo ""
    echo "📡 NFS Export Addresses:"
    
    # Get NFS export addresses properly
    for volume_name in $MATCHING_VOLUMES; do
        # Get volume details individually for more reliable results
        VOLUME_DETAILS=$(gcloud netapp volumes describe "$volume_name" \
            --location=$DEFAULT_REGION \
            --project=$PROJECT_ID \
            --format="value(mountOptions[0].ipAddress,shareName,mountOptions[0].export)" 2>/dev/null)
        
        if [ -n "$VOLUME_DETAILS" ]; then
            IFS=$'\t' read -r ip_address share_name export_path <<< "$VOLUME_DETAILS"
            
            # Clean up IP address format (remove brackets and quotes)
            clean_ip=$(echo "$ip_address" | sed 's/\[//g' | sed 's/\]//g' | sed "s/'//g" | sed 's/"//g')
            
            # Use export path if available, otherwise construct from share name
            if [ -n "$export_path" ] && [ "$export_path" != "" ]; then
                nfs_path="$clean_ip:$export_path"
            else
                # Fallback: construct export path from share name
                nfs_path="$clean_ip:/$share_name"
            fi
            
            echo "$nfs_path"
            
            # Store for potential use in automation script
            echo "VOLUME_NAME=$volume_name" >> existing_volumes.env
            echo "NFS_EXPORT=$nfs_path" >> existing_volumes.env
        else
            echo "⚠️  Could not get details for volume: $volume_name"
        fi
    done
    
    echo ""
    echo "📋 Detailed Volume Information:"
    gcloud netapp volumes list \
        --location=$DEFAULT_REGION \
        --project=$PROJECT_ID \
        --filter="name~'$VOLUME_PREFIX.*'" \
        --format="table(
            name:label='Volume Name',
            shareName:label='Share Name',
            capacityGib:label='Size (GiB)',
            state:label='Status',
            mountOptions[].ipAddress:label='IP Address',
            mountOptions[].exportPath:label='Export Path'
        )"
    
    echo ""
    echo "💾 Export addresses saved to 'existing_volumes.env' for automation use"
    echo ""
    
    # Create a summary file for the automation script
    cat > nfs_exports.txt << EOF
# NFS Export Addresses for Migration
# Generated on $(date)
# Storage Pool: $STORAGE_POOL_NAME
# Volume Prefix: $VOLUME_PREFIX
# Volume Count: $VOLUME_COUNT

EOF
    
    # Add each NFS export to the file
    for volume_name in $MATCHING_VOLUMES; do
        VOLUME_DETAILS=$(gcloud netapp volumes describe "$volume_name" \
            --location=$DEFAULT_REGION \
            --project=$PROJECT_ID \
            --format="value(mountOptions[0].ipAddress,shareName,mountOptions[0].export)" 2>/dev/null)
        
        if [ -n "$VOLUME_DETAILS" ]; then
            IFS=$'\t' read -r ip_address share_name export_path <<< "$VOLUME_DETAILS"
            clean_ip=$(echo "$ip_address" | sed 's/\[//g' | sed 's/\]//g' | sed "s/'//g" | sed 's/"//g')
            
            if [ -n "$export_path" ] && [ "$export_path" != "" ]; then
                nfs_path="$clean_ip:$export_path"
            else
                nfs_path="$clean_ip:/$share_name"
            fi
            
            echo "NFS_EXPORT_$volume_name=$nfs_path" >> nfs_exports.txt
        fi
    done
    
    echo "📄 NFS exports saved to 'nfs_exports.txt'"
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ NetApp volume deployment script completed"
    echo ""
    echo "🚀 Ready for migration! Use the NFS addresses above in your migration automation."
    
    exit 0
fi

// ...existing code...


read -p "Enter volume/share prefix [$DEFAULT_VOLUME_PREFIX]: " VOLUME_PREFIX
VOLUME_PREFIX=${VOLUME_PREFIX:-$DEFAULT_VOLUME_PREFIX}

# Use the same prefix for both volume and share names
SHARE_PREFIX=$VOLUME_PREFIX

read -p "Enter number of volumes to create [$DEFAULT_VOLUME_COUNT]: " VOLUME_COUNT
VOLUME_COUNT=${VOLUME_COUNT:-$DEFAULT_VOLUME_COUNT}

read -p "Enter volume size in GiB [$DEFAULT_VOLUME_SIZE]: " VOLUME_SIZE
VOLUME_SIZE=${VOLUME_SIZE:-$DEFAULT_VOLUME_SIZE}

# Check if there's enough capacity in the storage pool
TOTAL_REQUIRED=$((VOLUME_COUNT * VOLUME_SIZE))
if [ $TOTAL_REQUIRED -gt $AVAILABLE_CAPACITY ]; then
    echo ""
    echo "⚠️  WARNING: Capacity Check Failed!"
    echo "   Requested: ${TOTAL_REQUIRED}GiB (${VOLUME_COUNT} volumes × ${VOLUME_SIZE}GiB each)"
    echo "   Available: ${AVAILABLE_CAPACITY}GiB"
    echo ""
    read -p "Continue anyway? (y/N): " CAPACITY_OVERRIDE
    if [[ ! $CAPACITY_OVERRIDE =~ ^[Yy]$ ]]; then
        echo "❌ Deployment cancelled due to insufficient capacity."
        exit 1
    fi
fi

echo "Protocols Configuration:"
PROTOCOLS="NFSV3" # Default to NFSv3


AUTO_TIERING="false"
COOLING_THRESHOLD=30


# Export rules for NFS protocols
if [[ $PROTOCOLS == *"NFS"* ]]; then
    ALLOWED_CLIENTS=$DEFAULT_ALLOWED_CLIENTS
    ACCESS_TYPE=$DEFAULT_ACCESS_TYPE
    ROOT_ACCESS=$DEFAULT_ROOT_ACCESS
    
    echo "✅ NFS Export Rules (using defaults):"
    echo "   Allowed clients: $ALLOWED_CLIENTS"
    echo "   Access type: $ACCESS_TYPE"
    echo "   Root access: $ROOT_ACCESS"
fi

ENABLE_SNAPSHOTS="false"
HOURLY_SNAPSHOTS=0
DAILY_SNAPSHOTS=0
SNAPSHOT_HOUR=2
SNAPSHOT_MINUTE=0


# read -p "Enter GCP region [$DEFAULT_REGION]: " REGION
REGION=${REGION:-$DEFAULT_REGION}

# read -p "Enter environment (dev/staging/prod) [$DEFAULT_ENVIRONMENT]: " ENVIRONMENT
# ENVIRONMENT=${ENVIRONMENT:-$DEFAULT_ENVIRONMENT}

echo ""
echo "⚠️  CLEANUP OPTION:"
echo "Do you want to delete ALL existing NetApp volumes in storage pool '$STORAGE_POOL_NAME'?"
read -p "Delete existing volumes? (y/N): " CLEANUP_CHOICE
if [[ $CLEANUP_CHOICE =~ ^[Yy]$ ]]; then
    CLEANUP_EXISTING="true"
    echo "⚠️  WARNING: This will delete existing NetApp volumes!"
else
    CLEANUP_EXISTING="false"
fi

echo ""
echo "🔵 ===== NETAPP VOLUME DEPLOYMENT CONFIGURATION ===== 🔵"
echo "Storage Pool: $STORAGE_POOL_NAME"
echo "Available Capacity: ${AVAILABLE_CAPACITY}GiB"
echo "Volume Prefix: $VOLUME_PREFIX"
echo "Share Prefix: $SHARE_PREFIX"
echo "Volume Count: $VOLUME_COUNT"
echo "Volume Size: ${VOLUME_SIZE}GiB each"
echo "Total Required: ${TOTAL_REQUIRED}GiB"
echo "Protocols: $PROTOCOLS"
echo "Auto-tiering: $AUTO_TIERING"
if [[ $PROTOCOLS == *"NFS"* ]]; then
    echo "Allowed Clients: $ALLOWED_CLIENTS"
    echo "Access Type: $ACCESS_TYPE"
    echo "Root Access: $ROOT_ACCESS"
fi
echo "Region: $REGION"
# echo "Environment: $ENVIRONMENT"
echo "Cleanup Existing: $CLEANUP_EXISTING"
echo "Enable Snapshots: $ENABLE_SNAPSHOTS"
echo "=================================================================="

# Set Terraform variables for NetApp Volumes
export TF_VAR_project_id=$PROJECT_ID
export TF_VAR_region=$REGION
export TF_VAR_storage_pool_name=$STORAGE_POOL_NAME
export TF_VAR_use_existing_storage_pool="true"  # Always true since we're using existing pool
export TF_VAR_volume_name_prefix=$VOLUME_PREFIX
export TF_VAR_share_name_prefix=$SHARE_PREFIX
export TF_VAR_volume_count=$VOLUME_COUNT
export TF_VAR_volume_capacity_gib=$VOLUME_SIZE
export TF_VAR_protocols='["'$PROTOCOLS'"]'
export TF_VAR_cleanup_existing_volumes=$CLEANUP_EXISTING
# export TF_VAR_environment=$ENVIRONMENT
export TF_VAR_vpc_network=$DEFAULT_NETWORK
export TF_VAR_auto_tiering_enabled=$AUTO_TIERING
export TF_VAR_cooling_threshold_days=$COOLING_THRESHOLD
export TF_VAR_enable_snapshot_policy=$ENABLE_SNAPSHOTS
export TF_VAR_hourly_snapshots_to_keep=$HOURLY_SNAPSHOTS
export TF_VAR_daily_snapshots_to_keep=$DAILY_SNAPSHOTS
export TF_VAR_snapshot_hour=$SNAPSHOT_HOUR
export TF_VAR_snapshot_minute=$SNAPSHOT_MINUTE

# NFS-specific variables
if [[ $PROTOCOLS == *"NFS"* ]]; then
    export TF_VAR_allowed_clients=$ALLOWED_CLIENTS
    export TF_VAR_access_type=$ACCESS_TYPE
    export TF_VAR_root_access=$ROOT_ACCESS
fi

echo ""
echo "🔧 Initializing Terraform..."
terraform init

echo ""
echo "📋 Planning Terraform deployment..."
terraform plan

echo ""
read -p "Do you want to apply these changes? (y/N): " APPLY_CHOICE
if [[ $APPLY_CHOICE =~ ^[Yy]$ ]]; then
    echo "🚀 Applying Terraform configuration..."
    terraform apply -auto-approve
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "🎉 ===== DEPLOYMENT SUCCESSFUL ===== 🎉"
        echo ""
        
        echo "📋 Created NetApp Volumes:"
        terraform output -json volume_details 2>/dev/null | jq -r '.[]' || echo "Volume details not available"
        
        echo ""
        echo "💾 NetApp Volume Summary:"
        gcloud netapp volumes list \
            --location=$REGION \
            --filter="name~'$VOLUME_PREFIX-.*'" \
            --format="table(
                name:label='Volume Name',
                shareName:label='Share Name',
                capacityGib:label='Size (GiB)',
                protocols:label='Protocols',
                state:label='Status'
            )"
        
        echo ""
        echo "🏊 Updated Storage Pool Status:"
        gcloud netapp storage-pools describe $STORAGE_POOL_NAME \
            --location=$REGION \
            --format="table(
                name:label='Storage Pool',
                state:label='State',
                capacityGib:label='Total (GiB)',
                allocatedGib:label='Allocated (GiB)',
                volumeCount:label='Volumes'
            )"
        
        echo ""
        echo "✅ NetApp Volume deployment completed successfully!"
        
    else
        echo "❌ Terraform apply failed!"
        exit 1
    fi
else
    echo "❌ Deployment cancelled by user."
    exit 0
fi


# ...existing code...

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 ===== DEPLOYMENT SUCCESSFUL ===== 🎉"
    echo ""
    
    echo "📡 NFS Export Addresses (ip:/mountpath):"
    terraform output -json nfs_export_addresses 2>/dev/null | jq -r '.[]' 2>/dev/null || {
        echo "Fetching NFS addresses from gcloud..."
        gcloud netapp volumes list \
            --location=$REGION \
            --filter="name~'$VOLUME_PREFIX-.*'" \
            --format="value(mountOptions.ipAddress,mountOptions.exportPath)" | \
            while IFS=$'\t' read -r ip path; do
                echo "$ip:$path"
            done
    }
    
    echo ""
    echo "🔗 NFS Mount Commands:"
    terraform output -json nfs_mount_commands 2>/dev/null | jq -r '.[]' 2>/dev/null || echo "Mount commands not available"
    
    echo ""
    echo "📋 Volume Details:"
    terraform output -json volume_mount_info 2>/dev/null | jq -r '.[] | "Volume: \(.volume_name) | NFS: \(.nfs_address) | Size: \(.capacity_gib)GiB | Status: \(.state)"' 2>/dev/null || echo "Volume details not available"
    
    echo ""
    echo "💾 NetApp Volume Summary:"
    gcloud netapp volumes list \
        --location=$REGION \
        --filter="name~'$VOLUME_PREFIX-.*'" \
        --format="table(
            name:label='Volume Name',
            shareName:label='Share Name',
            capacityGib:label='Size (GiB)',
            state:label='Status',
            mountOptions.ipAddress:label='IP Address',
            mountOptions.exportPath:label='Export Path'
        )"
    
    echo ""
    echo "✅ NetApp Volume deployment completed successfully!"
    
else
    echo "❌ Terraform apply failed!"
    exit 1
fi

duration=$SECONDS
echo ""
echo "⏱️  Total script time: $(($duration / 60)) minutes and $(($duration % 60)) seconds."
echo "📝 Log saved to $LOG_FILE"
