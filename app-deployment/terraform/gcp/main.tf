provider "google" {
  project = var.project_id
  region  = var.region
}

# Data source to get available zones in the region
data "google_compute_zones" "available" {
  region = var.region
  status = "UP"
}


locals {
  deployment_zone = var.selected_zone != "" ? var.selected_zone : data.google_compute_zones.available.names[0]
}

locals {
  deployment_subnetwork = var.subnetwork != "" ? var.subnetwork : "appmicro-vpc-subnet-01"
}

resource "google_compute_instance" "vm_instance" {
  count        = var.vm_count
  
  name         = var.instance_names[count.index]
  machine_type = var.machine_types[count.index]
  zone         = local.deployment_zone

  boot_disk {
    initialize_params {
      image = var.images[count.index]
    }
  }

  network_interface {
    network    = "appmicro-vpc1"
    subnetwork = local.deployment_subnetwork

  }

  tags = ["http-server"]

  labels = {
    creator = var.name_prefix
  }


  metadata_startup_script = <<EOT
#!/bin/bash
# Log everything for debugging
exec > /var/log/startup-script.log 2>&1
EOT

}

# Your existing outputs
# Add these outputs to your main.tf file
output "control_plane_instance_names" {
  value = slice(
    google_compute_instance.vm_instance[*].name,
    0,
    var.control_plane_count
  )
  description = "Names of control plane instances"
}

output "control_plane_zones" {
  value = slice(
    google_compute_instance.vm_instance[*].zone,
    0,
    var.control_plane_count
  )
  description = "Zones of control plane instances"
}

output "worker_instance_names" {
  value = slice(
    google_compute_instance.vm_instance[*].name,
    var.control_plane_count,
    var.control_plane_count + var.worker_count
  )
  description = "Names of worker instances"
}

output "worker_zones" {
  value = slice(
    google_compute_instance.vm_instance[*].zone,
    var.control_plane_count,
    var.control_plane_count + var.worker_count
  )
  description = "Zones of worker instances"
}

# Your existing outputs remain unchanged
output "control_plane_internal_ips" {
  value = slice(
    google_compute_instance.vm_instance[*].network_interface[0].network_ip,
    0,
    var.control_plane_count
  )
}

output "worker_internal_ips" {
  value = slice(
    google_compute_instance.vm_instance[*].network_interface[0].network_ip,
    var.control_plane_count,
    var.control_plane_count + var.worker_count
  )
}
