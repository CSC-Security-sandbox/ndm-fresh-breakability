provider "azurerm" {
  features {}

}

# Get the desired image version if specified
data "azurerm_shared_image_version" "worker_version" {
  count               = var.image_version != "" ? 1 : 0
  name                = var.image_version
  image_name          = var.image_definition
  gallery_name        = var.gallery_name
  resource_group_name = "datamigrate-acr-resource-group"
}

# Get the latest image if no version is specified
data "azurerm_shared_image" "worker" {
  count               = var.image_version == "" ? 1 : 0
  name                = var.image_definition
  gallery_name        = var.gallery_name
  resource_group_name = "datamigrate-acr-resource-group"
}

# Get network and subnet
data "azurerm_virtual_network" "vnet" {
  name                = var.vnet_name
  resource_group_name = var.resource_group
}

data "azurerm_subnet" "subnet" {
  name                 = var.subnet_name
  virtual_network_name = data.azurerm_virtual_network.vnet.name
  resource_group_name  = var.resource_group
}

resource "azurerm_network_interface" "nic" {
  count               = var.worker_count
  name                = "${var.vm_name_prefix}-nic-${count.index + 1}"
  location            = data.azurerm_virtual_network.vnet.location
  resource_group_name = var.resource_group

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    # No public IP assigned
  }
}

resource "azurerm_linux_virtual_machine" "wr_vm" {
  count               = var.worker_count
  name                = "${var.vm_name_prefix}-azure-automated-${count.index + 1}"
  resource_group_name = var.resource_group
  location            = data.azurerm_virtual_network.vnet.location
  size                = "Standard_D4s_v3"
  admin_username      = var.admin_username
  admin_password      = var.admin_password
  disable_password_authentication = false

  network_interface_ids = [
    azurerm_network_interface.nic[count.index].id,
  ]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }

  # Conditional source_image_id
  source_image_id = var.image_version != "" ? data.azurerm_shared_image_version.worker_version[0].id : data.azurerm_shared_image.worker[0].id

  tags = {
    environment = "dev"
    owner       = "user"
  }
}

output "worker_private_ips" {
  description = "The private IP addresses of the worker VMs"
  value       = azurerm_network_interface.nic[*].private_ip_address
}

output "worker_names" {
  description = "The names of the worker VMs"
  value       = azurerm_linux_virtual_machine.wr_vm[*].name
}

output "admin_password" {
  description = "The admin password for the VMs"
  value       = var.admin_password
  sensitive   = true
}
