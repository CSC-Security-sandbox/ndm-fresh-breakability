# Control Plane (Linux)
module "control_plane" {
  source            = "../../modules/linux"
  instance_name     = "${var.vm_owner}cp"
  ami_id            = var.control_plane_ami_id
  instance_type     = var.control_plane_instance_type
  subnet_id         = var.subnet_id
  security_group_id = var.security_group_id
  key_name          = var.key_name
  admin_username    = var.admin_username
  root_volume_size  = var.control_plane_root_volume_size

  tags = {
    environment = "dev"
    owner       = var.vm_owner
    role        = "control-plane"
    os          = "linux"
  }
}

# Linux Workers (NFS)
module "linux_workers" {
  count             = var.linux_worker_count
  source            = "../../modules/linux"
  instance_name     = "${var.vm_owner}lnx${count.index + 1}"
  ami_id            = var.linux_worker_ami_id
  instance_type     = var.linux_worker_instance_type
  subnet_id         = var.subnet_id
  security_group_id = var.security_group_id
  key_name          = var.key_name
  admin_username    = var.admin_username
  root_volume_size  = var.linux_worker_root_volume_size

  tags = {
    environment = "dev"
    owner       = var.vm_owner
    role        = "worker"
    os          = "linux"
    worker_id   = tostring(count.index + 1)
  }
}

# Windows Workers (SMB)
module "windows_workers" {
  count             = var.deploy_windows_workers ? var.windows_worker_count : 0
  source            = "../../modules/windows"
  instance_name     = "${var.vm_owner}win${count.index + 1}"
  instance_type     = var.windows_worker_instance_type
  subnet_id         = var.subnet_id
  security_group_id = var.security_group_id
  key_name          = var.key_name
  admin_username    = "datamigrator"
  admin_password    = var.admin_password
  root_volume_size  = var.windows_worker_root_volume_size

  tags = {
    environment = "dev"
    owner       = var.vm_owner
    role        = "worker"
    os          = "windows"
    worker_id   = tostring(count.index + 1)
  }
}
