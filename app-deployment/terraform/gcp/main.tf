provider "google" {
  project = var.project_id
  region  = var.region
}

# Data source to get available zones in the region
data "google_compute_zones" "available" {
  region = var.region
  status = "UP"
}

resource "google_compute_instance" "vm_instance" {
  count        = var.vm_count
  
  name         = var.instance_names[count.index]
  machine_type = var.machine_types[count.index]
  zone         = data.google_compute_zones.available.names[count.index % length(data.google_compute_zones.available.names)]

  boot_disk {
    initialize_params {
      image = var.images[count.index]
    }
  }

  network_interface {
    network    = "appmicro-vpc1"
    subnetwork = "appmicro-vpc-subnet-01"

  }

  tags = ["http-server"]


  metadata_startup_script = <<EOT
#!/bin/bash
# Log everything for debugging
exec > /var/log/startup-script.log 2>&1
EOT

}

# Your existing outputs
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