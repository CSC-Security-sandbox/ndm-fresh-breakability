# Data source to get available zones in the region
data "google_compute_zones" "available" {
  region = var.region
  status = "UP"
}

locals {
  available_zones = data.google_compute_zones.available.names

  startup_script = <<-EOT
#!/bin/bash
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

{
echo "net.core.rmem_max=268435456"
echo "net.core.wmem_max=268435456"
echo "net.ipv4.tcp_rmem=4096 87380 268435456"
echo "net.ipv4.tcp_wmem=4096 65536 268435456"
echo "net.ipv4.tcp_window_scaling=1"
echo "net.core.netdev_max_backlog=30000"
echo "sunrpc.tcp_max_slot_table_entries=128"
echo "sunrpc.tcp_slot_table_entries=128"
} >> /etc/sysctl.d/99-migration-tuning.conf

echo "TCP and NFS tuning applied"
EOT
}

# ---------------------------------------------------------------------------
# Control Plane (Linux) — no gVNIC needed, not on the data path
# ---------------------------------------------------------------------------
module "control_plane" {
  source = "../../modules/linux"

  vm_name      = "${var.vm_owner}cp"
  machine_type = var.control_plane_machine_type
  zone         = local.available_zones[0]
  image        = var.control_plane_image
  network      = var.network
  subnetwork   = var.subnetwork
  enable_gvnic = false

  admin_username        = var.admin_username
  admin_password        = var.admin_password
  admin_ssh_public_key  = var.admin_ssh_public_key
  admin_ssh_private_key = var.admin_ssh_private_key
  assign_public_ip      = false
  startup_script        = local.startup_script

  labels = {
    environment = "dev"
    owner       = "automation"
    role        = "control-plane"
  }
}

# ---------------------------------------------------------------------------
# Linux Workers — gVNIC enabled for data transfer throughput
# ---------------------------------------------------------------------------
module "linux_workers" {
  count  = var.linux_worker_count
  source = "../../modules/linux"

  vm_name      = "${var.vm_owner}lnx${count.index + 1}"
  machine_type = var.worker_machine_type
  zone         = local.available_zones[(count.index + 1) % length(local.available_zones)]
  image        = var.worker_image
  network      = var.network
  subnetwork   = var.subnetwork
  enable_gvnic = var.enable_gvnic

  admin_username        = var.admin_username
  admin_password        = var.admin_password
  admin_ssh_public_key  = var.admin_ssh_public_key
  admin_ssh_private_key = var.admin_ssh_private_key
  assign_public_ip      = false
  startup_script        = local.startup_script

  labels = {
    environment = "dev"
    owner       = "automation"
    role        = "worker"
    os          = "linux"
    worker-id   = tostring(count.index + 1)
  }
}

# ---------------------------------------------------------------------------
# Windows Workers — gVNIC enabled for data transfer throughput
# ---------------------------------------------------------------------------
module "windows_workers" {
  count  = var.deploy_windows_workers ? var.windows_worker_count : 0
  source = "../../modules/windows"

  vm_name      = "${var.vm_owner}win${count.index + 1}"
  machine_type = var.windows_worker_machine_type
  zone         = local.available_zones[(count.index + 1) % length(local.available_zones)]
  image        = var.windows_image
  network      = var.network
  subnetwork   = var.subnetwork
  enable_gvnic = var.enable_gvnic

  admin_username = var.admin_username
  admin_password = var.admin_password
  dns_servers    = var.dns_servers
  enable_openssh = true
  assign_public_ip = false

  labels = {
    environment = "dev"
    owner       = "automation"
    role        = "worker"
    os          = "windows"
    worker-id   = tostring(count.index + 1)
  }
}
