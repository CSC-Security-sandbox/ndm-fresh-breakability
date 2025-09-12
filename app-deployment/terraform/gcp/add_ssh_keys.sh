#!/bin/bash

# Simplified script to add SSH keys to GCP VMs and output private key
# Usage: ./add_ssh_keys.sh <region> <vm-name>

set -e

# Default values
PROJECT_ID="app-microservices-cm"
USERNAME="ndmuser"

# Check if required arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <region> <vm-name>"
    echo "Example: $0 us-east1 my-vm-name"
    exit 1
fi

REGION="$1"
VM_NAME="$2"

echo "Adding SSH key to VM: $VM_NAME in region: $REGION"

# Check if gcloud is available
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud could not be found. Please install the Google Cloud SDK."
    exit 1
fi

# Set project
gcloud config set project "$PROJECT_ID" > /dev/null 2>&1
echo "Using project: $PROJECT_ID"

# Find VM zone in the specified region
echo "Finding VM '$VM_NAME' in region '$REGION'..."
VM_ZONE=$(gcloud compute instances list \
    --filter="name=$VM_NAME AND zone:$REGION" \
    --project="$PROJECT_ID" \
    --format="value(zone.basename())" \
    --limit=1 2>/dev/null)

if [ -z "$VM_ZONE" ]; then
    echo "Error: VM '$VM_NAME' not found in region '$REGION'"
    exit 1
fi

echo "Found VM '$VM_NAME' in zone: $VM_ZONE"

# Function to generate SSH key pair (based on run.sh)
generate_ssh_key() {
        # local vm_name="$1"

        # Create temporary key files (will be deleted immediately)
        local temp_dir=$(mktemp -d)
        local key_path="${temp_dir}/${VM_NAME}_key"

        # Generate SSH key pair
        ssh-keygen -t rsa -b 2048 -f "$key_path" -N "" -C "ndmuser@${VM_NAME}" -q

        if [ $? -eq 0 ]; then
            echo "SSH key generated for $VM_NAME" >&2

            # Read both private and public key content
            local private_key=$(cat "$key_path" | base64 -w 0)  # Base64 encode to handle newlines
            local public_key=$(cat "${key_path}.pub")

            # Clean up temporary files immediately
            rm -rf "$temp_dir"

            # Return both keys in a structured format
            echo "${private_key}|${public_key}"
            return 0
        else
            echo "Failed to generate SSH key for $VM_NAME" >&2
            rm -rf "$temp_dir"
            return 1
        fi
    }

# Function to clear existing SSH keys from VM
clear_ssh_keys_from_vm() {
    local vm_name="$1"
    local vm_zone="$2"
    
    echo "Clearing existing SSH keys from $vm_name..."
    
    # Remove ssh-keys metadata from VM
    gcloud compute instances remove-metadata "$vm_name" \
        --zone="$vm_zone" \
        --keys=ssh-keys \
        --project="$PROJECT_ID" >/dev/null 2>&1
        
    if [ $? -eq 0 ]; then
        echo "Existing SSH keys cleared from $vm_name"
        return 0
    else
        echo "Warning: Could not clear existing SSH keys from $vm_name (might not exist)"
        return 0  # Don't fail if no existing keys
    fi
}

# Function to add SSH key to VM (clean version)
add_ssh_key_to_vm() {
    local vm_name="$1"
    local vm_zone="$2" 
    local public_key_content="$3"
    
    echo "Adding SSH key to $vm_name..." 
    echo "Key Content: $public_key_content" 
    
    # Format: username:ssh-key-type key-data optional-comment
    local ssh_keys="${USERNAME}:$public_key_content"
    
    # Add SSH key to VM metadata (replacing any existing keys)
    gcloud compute instances add-metadata "$vm_name" \
        --zone="$vm_zone" \
        --metadata ssh-keys="$ssh_keys" \
        --project="$PROJECT_ID" >/dev/null 2>&1
        
    if [ $? -eq 0 ]; then
        echo "SSH key added to $vm_name successfully"
         # Debug: verify what was actually set
        verification=$(gcloud compute instances describe "$vm_name" \
            --zone="$vm_zone" \
            --project="$PROJECT_ID" \
            --format="value(metadata.items[key=ssh-keys].value)" 2>/dev/null)
        echo "Verification - SSH keys now set to:" >&2
        echo "$verification" >&2
        echo "" >&2
        return 0
    else
        echo "Error: Failed to add SSH key to $vm_name"
        return 1
    fi
}

# Clear existing SSH keys from VM
clear_ssh_keys_from_vm "$VM_NAME" "$VM_ZONE"

# Generate SSH key pair
echo "Generating SSH key pair..."
key_data=$(generate_ssh_key "$VM_NAME")
if [ $? -ne 0 ] || [ -z "$key_data" ]; then
    echo "Error: Failed to generate SSH key"
    exit 1
fi

# Extract private and public keys
private_key=$(echo "$key_data" | cut -d'|' -f1)
public_key=$(echo "$key_data" | cut -d'|' -f2)

# Add SSH key to VM
add_ssh_key_to_vm "$VM_NAME" "$VM_ZONE" "$public_key"
if [ $? -ne 0 ]; then
    echo "Error: Failed to add SSH key to VM"
    exit 1
fi

# Save private key to a secure file
PRIVATE_KEY_FILE="${VM_NAME}_private_key.pem"
echo "$private_key" > "$PRIVATE_KEY_FILE"
chmod 600 "$PRIVATE_KEY_FILE"

echo ""
echo "===== SSH KEY SETUP COMPLETED ====="
echo "VM: $VM_NAME (Zone: $VM_ZONE)"
echo "Username: $USERNAME"
echo ""
echo "===== PUBLIC KEY ====="
echo "$public_key"
echo "===== END PUBLIC KEY ====="
echo ""
echo "Private key saved to: $PRIVATE_KEY_FILE"
echo ""
echo "===== PRIVATE KEY ===="
echo "$private_key"
echo "To connect to the VM:"
echo "1. Get VM IP: gcloud compute instances describe $VM_NAME --zone=$VM_ZONE --project=$PROJECT_ID --format='get(networkInterfaces[0].networkIP)'"
echo "2. Connect: ssh -i $PRIVATE_KEY_FILE ${USERNAME}@<VM_IP>"
