#!/bin/bash

# for log file creation
LOG_FILE="deploy_$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1



SECONDS=0


if ! command -v gcloud &> /dev/null; then
    echo "gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi


PROJECT_ID="app-microservices-cm"
DEFAULT_REGION="us-east4"
DEFAULT_CP_MACHINE_TYPE="e2-custom-8-32768"
DEFAULT_CP_COUNT=1
DEFAULT_CP_IMAGE_FAMILY=""
DEFAULT_WORKER_MACHINE_TYPE="e2-custom-4-16384"
DEFAULT_WORKER_COUNT=1
DEFAULT_WORKER_IMAGE_FAMILY=""
DEFAULT_NAME_PREFIX="daksh"
NAME_TIMESTAMP=$(date +%Y%m%d%H%M%S)



# Get latest images
# DEFAULT_CP_IMAGE=$(gcloud compute images list \
#   --project="${PROJECT_ID}" \
#   --filter="name~'cp|control-plane'" \
#   --sort-by="~creationTimestamp" \
#   --limit=1 \
#   --format="get(selfLink)")
# DEFAULT_WORKER_IMAGE=$(gcloud compute images list \
#   --project="${PROJECT_ID}" \
#   --filter="name~'worker'" \
#   --sort-by="~creationTimestamp" \
#   --limit=1 \
#   --format="get(selfLink)")
DEFAULT_WORKER_IMAGE=datamigrator-worker-06-09-2025-19-05-14
DEFAULT_CP_IMAGE=datamigrator-control-plane-06-09-2025-19-10-00

read -p "Enter name prefix for instances [${DEFAULT_NAME_PREFIX}]: " NAME_PREFIX
NAME_PREFIX=${NAME_PREFIX:-${DEFAULT_NAME_PREFIX:-$NAME_PREFIX}}

read -p "Enter number of control plane nodes [${DEFAULT_CP_COUNT}]: " CONTROL_PLANE_COUNT
CONTROL_PLANE_COUNT=${CONTROL_PLANE_COUNT:-$DEFAULT_CP_COUNT}

read -p "Enter number of worker nodes [${DEFAULT_WORKER_COUNT}]: " WORKER_COUNT
WORKER_COUNT=${WORKER_COUNT:-$DEFAULT_WORKER_COUNT}

VM_COUNT=$((CONTROL_PLANE_COUNT + WORKER_COUNT))

read -p "Enter machine type for all control plane nodes [${DEFAULT_CP_MACHINE_TYPE}]: " CP_MACHINE_TYPE
CP_MACHINE_TYPE=${CP_MACHINE_TYPE:-$DEFAULT_CP_MACHINE_TYPE}

read -p "Enter image for control plane [${DEFAULT_CP_IMAGE}]: " CP_IMAGE
CP_IMAGE=${CP_IMAGE:-$DEFAULT_CP_IMAGE}

read -p "Enter machine type for all worker nodes [${DEFAULT_WORKER_MACHINE_TYPE}]: " WORKER_MACHINE_TYPE
WORKER_MACHINE_TYPE=${WORKER_MACHINE_TYPE:-$DEFAULT_WORKER_MACHINE_TYPE}

read -p "Enter image for worker [${DEFAULT_WORKER_IMAGE}]: " WORKER_IMAGE
WORKER_IMAGE=${WORKER_IMAGE:-$DEFAULT_WORKER_IMAGE}

read -p "Enter your GCP region [${DEFAULT_REGION}]: " REGION
REGION=${REGION:-$DEFAULT_REGION}

echo name prefix: "$NAME_PREFIX"
echo name default: "$DEFAULT_NAME_PREFIX"



MACHINE_TYPES=()
IMAGES=()
NAMES=()


TODAY_DATE=$(date +%d%m)
BUILD_TIME=$(date +%H%M%S) 

# Function to extract image creation date from image URL/name
get_image_date() {
    local image_url="$1"
    if [ -n "$image_url" ]; then
        # Extract image name from the URL (handle both full URLs and just names)
        local image_name
        if [[ "$image_url" == *"/"* ]]; then
            image_name=$(basename "$image_url")
        else
            image_name="$image_url"
        fi

        echo "🔍 Extracting date from image: $image_name" >&2

        local date_part=$(echo "$image_name" | grep -oE '[0-9]{2}-[0-9]{2}-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}')
        local day_month=$(echo "$date_part" | cut -d'-' -f1,2)
        local day=$(echo "$day_month" | cut -d'-' -f1)
        local month=$(echo "$day_month" | cut -d'-' -f2)
        local image_date="${day}${month}"
        echo "$image_date"
    fi
        
}

# image creation dates
CP_IMAGE_DATE=$(get_image_date "$CP_IMAGE")
WORKER_IMAGE_DATE=$(get_image_date "$WORKER_IMAGE")

echo name prefix: "$NAME_PREFIX"

# UNIQUE NAMES
for i in $(seq 1 $CONTROL_PLANE_COUNT); do
  MACHINE_TYPES+=("$CP_MACHINE_TYPE")
  IMAGES+=("$CP_IMAGE")
  NAMES+=("cp-${CP_IMAGE_DATE}-build-${TODAY_DATE}-run-${BUILD_TIME}-${NAME_PREFIX}")
done

for i in $(seq 1 $WORKER_COUNT); do
  MACHINE_TYPES+=("$WORKER_MACHINE_TYPE")
  IMAGES+=("$WORKER_IMAGE")
  NAMES+=("wk-${WORKER_IMAGE_DATE}-build-${TODAY_DATE}-run-${BUILD_TIME}-${NAME_PREFIX}-${i}")
done

MACHINE_TYPES_JSON=$(printf '%s\n' "${MACHINE_TYPES[@]}" | jq -R . | jq -s .)
IMAGES_JSON=$(printf '%s\n' "${IMAGES[@]}" | jq -R . | jq -s .)
NAMES_JSON=$(printf '%s\n' "${NAMES[@]}" | jq -R . | jq -s .)

echo Images JSON: "$IMAGES_JSON"
echo Machine Types JSON: "$MACHINE_TYPES_JSON"
echo Instance Names JSON: "$NAMES_JSON"

AVAILABLE_ZONES=$(gcloud compute zones list --filter="region:$REGION AND status:UP" --format="value(name)")
ZONES_ARRAY=($AVAILABLE_ZONES)

if [ ${#ZONES_ARRAY[@]} -eq 0 ]; then
    echo "❌ No available zones found in region $REGION"
    exit 1
fi

echo "📍 Available zones: ${#ZONES_ARRAY[@]} zones found"

# Simple zone validation
SELECTED_ZONE=""
for zone in $AVAILABLE_ZONES; do
    echo "  Testing zone: $zone"
    
    # Check if both machine types exist in zone
    CP_AVAILABLE=$(gcloud compute machine-types describe $CP_MACHINE_TYPE --zone=$zone --format="value(name)" 2>/dev/null)
    WORKER_AVAILABLE=$(gcloud compute machine-types describe $WORKER_MACHINE_TYPE --zone=$zone --format="value(name)" 2>/dev/null)
    
    if [ -n "$CP_AVAILABLE" ] && [ -n "$WORKER_AVAILABLE" ]; then
        SELECTED_ZONE=$zone
        echo "  ✅ Zone $zone selected"
        break
    else
        echo "  ❌ Zone $zone not suitable"
    fi
done

if [ -z "$SELECTED_ZONE" ]; then
    echo "❌ No suitable zone found"
    exit 1
fi

echo "🎯 Selected Zone: $SELECTED_ZONE"


export TF_VAR_project_id=$PROJECT_ID
export TF_VAR_region=$REGION
export TF_VAR_selected_zone=$SELECTED_ZONE
export TF_VAR_vm_count=$VM_COUNT
export TF_VAR_name_prefix=$NAME_PREFIX
export TF_VAR_machine_types="$MACHINE_TYPES_JSON"
export TF_VAR_images="$IMAGES_JSON"
export TF_VAR_control_plane_count=$CONTROL_PLANE_COUNT
export TF_VAR_worker_count=$WORKER_COUNT
export TF_VAR_instance_names="$NAMES_JSON"
export TF_VAR_subnetwork="us-e4-sn"


echo "Initializing Terraform..."
terraform init

echo "Applying new Terraform configuration..."
terraform apply -auto-approve

# IPs after successful deployment
if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 ===== DEPLOYMENT SUCCESSFUL ===== 🎉"
    echo ""
    
    echo "Waiting for resources to be fully ready..."
    sleep 10
    
    # Refresh terraform state
    terraform refresh
    
    echo "Control Plane Internal IPs:"
    if terraform output control_plane_internal_ips > /dev/null 2>&1; then
        terraform output -json control_plane_internal_ips | jq -r '.[] | " Control Plane IP: " + .'
    else
        echo "Control plane IPs not yet available. Trying alternative method..."
        terraform output -json control_plane_internal_ips 2>/dev/null | jq -r '.[] | "  Control Plane IP: " + .' || echo "  ❌ Unable to retrieve control plane IPs"
    fi
    
    echo ""
    echo "Worker Internal IPs:"
    if terraform output worker_internal_ips > /dev/null 2>&1; then
        terraform output -json worker_internal_ips | jq -r '.[] | "  Worker IP: " + .'
    else
        echo "Worker IPs not yet available. Trying alternative method..."
        terraform output -json worker_internal_ips 2>/dev/null | jq -r '.[] | "  Worker IP: " + .' || echo "  ❌ Unable to retrieve worker IPs"
    fi
    
    echo ""
    echo "Terraform State Status:"
    terraform show -json | jq -e '.values.outputs | keys[]' > /dev/null 2>&1 && echo "Terraform outputs are available" || echo "⚠️ Terraform outputs may not be ready"
    
    echo ""
else
    echo "Terraform apply failed!"
    exit 1
fi

duration=$SECONDS
echo "Total script time: $(($duration / 60)) minutes and $(($duration % 60)) seconds."
echo "Log saved to $LOG_FILE"



  
