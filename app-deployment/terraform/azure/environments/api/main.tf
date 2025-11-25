# Control Plane (Linux)
module "control_plane" {
  count                           = var.deploy_control_plane ? var.control_plane_count : 0
  source                          = "../../modules/linux"
  vm_name                         = var.control_plane_count > 1 ? "${var.vm_owner}-cp-${count.index + 1}-api" : "${var.vm_owner}-cp-api"
  resource_group                  = var.resource_group
  gallery_resource_group          = var.gallery_resource_group
  vnet_name                       = var.vnet_name
  subnet_name                     = var.subnet_name
  vm_size                         = var.control_plane_vm_size
  admin_username                  = var.admin_username
  admin_password                  = var.admin_password
  gallery_name                    = var.gallery_name
  image_definition                = var.control_plane_image_definition
  image_version                   = var.control_plane_image_version
  location                        = var.location
  disable_password_authentication = false
  assign_public_ip                = false

  tags = {
    environment = "dev"
    owner       = "user"
    role        = "control-plane"
    cp_id       = count.index + 1
  }
}

# # Linux Workers
module "linux_workers" {
  count                           = var.deploy_linux_workers ? var.linux_worker_count : 0
  source                          = "../../modules/linux"
  vm_name                         = "${var.vm_owner}-worker-linux-${count.index + 1}-api"
  resource_group                  = var.resource_group
  gallery_resource_group          = var.gallery_resource_group
  vnet_name                       = var.vnet_name
  subnet_name                     = var.subnet_name
  vm_size                         = var.worker_vm_size
  admin_username                  = var.admin_username
  admin_password                  = var.admin_password
  gallery_name                    = var.gallery_name
  image_definition                = var.worker_image_definition
  image_version                   = var.worker_image_version
  location                        = var.location
  disable_password_authentication = false
  assign_public_ip                = false

  tags = {
    environment = "dev"
    owner       = "user"
    role        = "worker"
    os          = "linux"
    worker_id   = count.index + 1
  }
}

# Windows Workers
module "windows_workers" {
  count                    = var.deploy_windows_workers ? var.windows_worker_count : 0
  source                   = "../../modules/windows"
  vm_name                  = "${var.vm_owner}-worker-windows-${count.index + 1}-api"
  computer_name            = "win-worker-${count.index + 1}"
  resource_group           = var.resource_group
  vm_size                  = var.windows_worker_vm_size
  admin_username           = var.admin_username
  admin_password           = var.admin_password
  vnet_name                = var.vnet_name
  subnet_name              = var.subnet_name
  windows_image_publisher  = var.windows_image_publisher
  windows_image_offer      = var.windows_image_offer
  windows_image_sku        = var.windows_image_sku
  windows_image_version    = var.windows_image_version
  location                 = var.location
  dns_servers              = var.dns_servers
  assign_public_ip         = false
  timezone                 = "UTC"
  enable_automatic_updates = true
  enable_openssh           = true

  tags = {
    environment = "dev"
    owner       = "user"
    role        = "worker"
    os          = "windows"
    worker_id   = count.index + 1
  }
}
