terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

# Variables
variable "username" {
  description = "Username prefix for VM naming"
  type        = string
}

variable "cp_image_version" {
  description = "Control plane image version"
  type        = string
  default     = ""
}

variable "worker_image_version" {
  description = "Worker image version"
  type        = string
  default     = ""
}

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
  default     = "1630c6a9-d99b-498a-aca8-a271f7506bc0"
}

variable "resource_group" {
  description = "Resource group name"
  type        = string
  default     = "MigrationAsAService-dev-infra"
}

variable "location" {
  description = "Azure location"
  type        = string
  default     = "eastus2"
}

variable "vnet_name" {
  description = "Virtual network name"
  type        = string
  default     = "MigrationAsAService-dev-VNET02"
}

variable "subnet_name" {
  description = "Subnet name"
  type        = string
  default     = "MigrationAsAService-dev-VNET02_Subnet01"
}

variable "gallery_name" {
  description = "Shared image gallery name"
  type        = string
  default     = "datamigrator"
}

variable "source_image_resource_group" {
  description = "Source image resource group"
  type        = string
  default     = "datamigrate-acr-resource-group"
}

variable "admin_username" {
  description = "VM admin username"
  type        = string
  default     = "ubuntu"
}

variable "admin_password" {
  description = "VM admin password"
  type        = string
  default     = "Password@123"
}

# Generate timestamp for unique VM names
locals {
  timestamp = formatdate("YYYYMMDD-hhmmss", timestamp())
}

# Data sources for existing resources
data "azurerm_resource_group" "main" {
  name = var.resource_group
}

data "azurerm_virtual_network" "main" {
  name                = var.vnet_name
  resource_group_name = var.resource_group
}

data "azurerm_subnet" "main" {
  name                 = var.subnet_name
  virtual_network_name = var.vnet_name
  resource_group_name  = var.resource_group
}

# Get the latest control plane image if not specified
data "azurerm_shared_image" "cp_latest" {
  count               = var.cp_image_version == "" ? 1 : 0
  name                = "ndm-control-plane"
  gallery_name        = var.gallery_name
  resource_group_name = var.source_image_resource_group
}

# Get specific control plane image version if specified
data "azurerm_shared_image_version" "cp_specific" {
  count               = var.cp_image_version != "" ? 1 : 0
  name                = var.cp_image_version
  image_name          = "ndm-control-plane"
  gallery_name        = var.gallery_name
  resource_group_name = var.source_image_resource_group
}

# Get the latest worker image if not specified
data "azurerm_shared_image" "worker_latest" {
  count               = var.worker_image_version == "" ? 1 : 0
  name                = "ndm-worker"
  gallery_name        = var.gallery_name
  resource_group_name = var.source_image_resource_group
}

# Get specific worker image version if specified
data "azurerm_shared_image_version" "worker_specific" {
  count               = var.worker_image_version != "" ? 1 : 0
  name                = var.worker_image_version
  image_name          = "ndm-worker"
  gallery_name        = var.gallery_name
  resource_group_name = var.source_image_resource_group
}

# Control Plane Network Interface
resource "azurerm_network_interface" "control_plane" {
  name                = "${var.username}-cp-azure-automated-perf-${local.timestamp}-nic"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
  }

  tags = {
    environment = "dev"
    owner       = var.username
  }
}

# Worker Network Interface
resource "azurerm_network_interface" "worker" {
  name                = "${var.username}-worker-azure-automated-perf-${local.timestamp}-nic"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = data.azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
  }

  tags = {
    environment = "dev"
    owner       = var.username
  }
}

# Control Plane VM
resource "azurerm_linux_virtual_machine" "control_plane" {
  name                = "${var.username}-cp-azure-automated-perf-${local.timestamp}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  size                = "Standard_D8s_v3"
  zone                = "1"

  disable_password_authentication = false
  admin_username                  = var.admin_username
  admin_password                  = var.admin_password

  network_interface_ids = [
    azurerm_network_interface.control_plane.id,
  ]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 200
  }

  source_image_id = var.cp_image_version == "" ? data.azurerm_shared_image.cp_latest[0].id : data.azurerm_shared_image_version.cp_specific[0].id

  boot_diagnostics {}

  tags = {
    environment = "dev"
    owner       = var.username
  }
}

# Worker VM
resource "azurerm_linux_virtual_machine" "worker" {
  name                = "${var.username}-worker-azure-automated-perf-${local.timestamp}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  size                = "Standard_D4s_v3"
  zone                = "1"

  disable_password_authentication = false
  admin_username                  = var.admin_username
  admin_password                  = var.admin_password

  network_interface_ids = [
    azurerm_network_interface.worker.id,
  ]

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 200
  }

  source_image_id = var.worker_image_version == "" ? data.azurerm_shared_image.worker_latest[0].id : data.azurerm_shared_image_version.worker_specific[0].id

  boot_diagnostics {}

  tags = {
    environment = "dev"
    owner       = var.username
  }
}

# Outputs
output "control_plane_ip" {
  description = "Private IP address of the control plane VM"
  value       = azurerm_network_interface.control_plane.private_ip_address
}

output "worker_ip" {
  description = "Private IP address of the worker VM"
  value       = azurerm_network_interface.worker.private_ip_address
}

output "control_plane_vm_name" {
  description = "Name of the control plane VM"
  value       = azurerm_linux_virtual_machine.control_plane.name
}

output "worker_vm_name" {
  description = "Name of the worker VM"
  value       = azurerm_linux_virtual_machine.worker.name
}
