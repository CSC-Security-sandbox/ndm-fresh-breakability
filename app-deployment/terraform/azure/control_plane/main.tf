provider "azurerm" {
  features {}
}

# Get the desired image version if specified
data "azurerm_shared_image_version" "cp_version" {
  count               = var.image_version != "" ? 1 : 0
  name                = var.image_version
  image_name          = var.image_definition
  gallery_name        = var.gallery_name
  resource_group_name = "datamigrate-acr-resource-group"
}

# Get the latest image if no version is specified
data "azurerm_shared_image" "control_plane" {
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
  name                = "${var.vm_name_prefix}-nic"
  location            = data.azurerm_virtual_network.vnet.location
  resource_group_name = var.resource_group

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.subnet.id
    private_ip_address_allocation = "Dynamic"
    
  }
}

resource "azurerm_linux_virtual_machine" "cp_vm" {
  name                = "${var.vm_name_prefix}-azure-automated"
  resource_group_name = var.resource_group
  location            = data.azurerm_virtual_network.vnet.location
  size                = "Standard_D8s_v3"
  admin_username      = var.admin_username
  admin_password      = var.admin_password
  disable_password_authentication = false

  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }

  # Conditional source_image_id
  source_image_id = var.image_version != "" ? data.azurerm_shared_image_version.cp_version[0].id : data.azurerm_shared_image.control_plane[0].id

  tags = {
    environment = "dev"
    owner       = "user"
  }
}

output "vm_private_ip" {
  description = "The private IP address of the VM"
  value       = azurerm_network_interface.nic.private_ip_address
}

output "vm_name" {
  description = "The name of the VM"
  value       = azurerm_linux_virtual_machine.cp_vm.name
}

output "admin_password" {
  description = "The admin password for the VM"
  value       = var.admin_password
  sensitive   = true
}