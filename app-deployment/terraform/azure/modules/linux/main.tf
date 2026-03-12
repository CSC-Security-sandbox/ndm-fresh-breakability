# Get Linux subnet
data "azurerm_subnet" "linux_subnet" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group
}

# Get the specified image version
data "azurerm_shared_image_version" "image_version" {
  name                = var.image_version
  image_name          = var.image_definition
  gallery_name        = var.gallery_name
  resource_group_name = var.gallery_resource_group
}

# Create public IP if requested
resource "azurerm_public_ip" "public_ip" {
  count               = var.assign_public_ip ? 1 : 0
  name                = "${var.vm_name}-public-ip"
  location            = var.location
  resource_group_name = var.resource_group
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = var.tags
}

# Create network interface
resource "azurerm_network_interface" "nic" {
  name                          = "${var.vm_name}-nic"
  location                      = var.location
  resource_group_name           = var.resource_group
  accelerated_networking_enabled = var.accelerated_networking

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.linux_subnet.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = var.assign_public_ip ? azurerm_public_ip.public_ip[0].id : null
  }

  tags = var.tags
}

# Create Linux Virtual Machine
resource "azurerm_linux_virtual_machine" "vm" {
  name                            = var.vm_name
  resource_group_name             = var.resource_group
  location                        = var.location
  size                            = var.vm_size
  admin_username                  = var.admin_username
  admin_password                  = var.admin_password
  disable_password_authentication = var.disable_password_authentication

  network_interface_ids = [
    azurerm_network_interface.nic.id,
  ]

  os_disk {
    caching              = var.os_disk_caching
    storage_account_type = var.os_disk_storage_account_type
  }

  source_image_id = data.azurerm_shared_image_version.image_version.id

  tags = var.tags
}
