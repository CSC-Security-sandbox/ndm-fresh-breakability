terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.40"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.40"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}


# Local values for volume management
locals {
  volume_names     = [for i in range(var.volume_count) : "${var.volume_name_prefix}-${i + 1}"]
  share_names      = [for i in range(var.volume_count) : "${var.share_name_prefix}-${i + 1}"]
  storage_pool_name = var.storage_pool_name
}

# Null resource to handle cleanup of existing volumes
resource "null_resource" "cleanup_existing_volumes" {
  count = var.cleanup_existing_volumes ? 1 : 0

  provisioner "local-exec" {
    command = <<EOT
#!/bin/bash
echo "🗑️  Cleaning up existing volumes in storage pool: ${var.storage_pool_name}"
echo " WARNING: This will delete EVERY volume in the storage pool!"

# Initialize counters
DELETED_COUNT=0
FAILED_COUNT=0

# Get list of existing volumes with the specified prefix
EXISTING_VOLUMES=$(gcloud netapp volumes list \
  --location=${var.region} \
  --filter="storagePool~'${var.storage_pool_name}'" \
  --format="value(name)" \
  --project=${var.project_id})

if [ -n "$EXISTING_VOLUMES" ]; then
  echo "Found existing volumes to delete:"
  echo "$EXISTING_VOLUMES"

  # Count total volumes
  VOLUME_COUNT=$(echo "$EXISTING_VOLUMES" | wc -l)
  echo "Total volumes to delete: $VOLUME_COUNT"
  echo ""
  
  
  # Delete each volume
  for volume_name in $EXISTING_VOLUMES; do
    if [ -n "$volume_name" ]; then
      echo "[$((DELETED_COUNT + FAILED_COUNT + 1))/$VOLUME_COUNT] Deleting volume: $volume_name"
      
      if gcloud netapp volumes delete "$volume_name" \
        --location=${var.region} \
        --project=${var.project_id} \
        --quiet; then
        echo "Successfully deleted: $volume_name"
        DELETED_COUNT=$((DELETED_COUNT + 1))
      else
        echo "Failed to delete: $volume_name"
        FAILED_COUNT=$((FAILED_COUNT + 1))
      fi
      
      # Wait between deletions to avoid rate limiting
      sleep 2
    fi
  done
  
  echo "🧹 Cleanup Summary:"
  echo "   Successfully deleted: $DELETED_COUNT volumes"
  echo "   Failed to delete: $FAILED_COUNT volumes"
  echo "   Total processed: $((DELETED_COUNT + FAILED_COUNT)) volumes"
else
  echo "No volumes found in storage pool '${var.storage_pool_name}'"
  echo "Storage pool is already clean!"
fi

# Wait for cleanup to complete
sleep 10
EOT
  }

  triggers = {
    cleanup_requested = var.cleanup_existing_volumes
    storage_pool     = var.storage_pool_name
    timestamp        = timestamp()
  }
}

## Create NetApp volumes (NFS only)
resource "google_netapp_volume" "volumes" {
  provider = google-beta 
  count    = var.volume_count
  location = var.region
  name     = local.volume_names[count.index]

  capacity_gib = var.volume_capacity_gib
  share_name   = local.share_names[count.index]
  storage_pool = local.storage_pool_name
  protocols    = var.protocols

  # Security style
  security_style = var.security_style


  # Export policy for NFS volumes
  export_policy {
    rules {
      allowed_clients = var.allowed_clients
      access_type     = var.access_type
      has_root_access = var.root_access 
      nfsv3           = contains(var.protocols, "NFSV3")
      nfsv4           = contains(var.protocols, "NFSV4")
    }
  }

  # Labels
  labels = merge(var.volume_labels, {
    protocol       = lower(join("-", var.protocols))
    creator        = "daksh-script"
  })

  depends_on = [
    null_resource.cleanup_existing_volumes
  ]

  lifecycle {
    prevent_destroy = false
    ignore_changes = [
      # Ignore changes to labels that might be added externally
      labels["goog-netapp-location"],
    ]
  }
}