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

  # Enable gVNIC for higher throughput and lower latency (GCP equivalent of Azure Accelerated Networking)
  advanced_machine_features {
    enable_nested_virtualization = false
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork
    nic_type   = var.enable_gvnic ? "GVNIC" : "VIRTIO_NET"
  }

  tags = ["http-server"]

  metadata_startup_script = <<EOT
#!/bin/bash
# Log everything for debugging
exec > /var/log/startup-script.log 2>&1

# TCP and NFS performance tuning for cross-region migrations
sysctl -w net.core.rmem_max=268435456
sysctl -w net.core.wmem_max=268435456
sysctl -w net.ipv4.tcp_rmem="4096 87380 268435456"
sysctl -w net.ipv4.tcp_wmem="4096 65536 268435456"
sysctl -w net.ipv4.tcp_window_scaling=1
sysctl -w net.core.netdev_max_backlog=30000
sysctl -w sunrpc.tcp_max_slot_table_entries=128
sysctl -w sunrpc.tcp_slot_table_entries=128

# Persist across reboots
cat >> /etc/sysctl.d/99-migration-tuning.conf <<SYSCTL
net.core.rmem_max=268435456
net.core.wmem_max=268435456
net.ipv4.tcp_rmem=4096 87380 268435456
net.ipv4.tcp_wmem=4096 65536 268435456
net.ipv4.tcp_window_scaling=1
net.core.netdev_max_backlog=30000
sunrpc.tcp_max_slot_table_entries=128
sunrpc.tcp_slot_table_entries=128
SYSCTL

echo "TCP and NFS tuning applied" >> /var/log/startup-script.log
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