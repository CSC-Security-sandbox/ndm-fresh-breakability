terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~>3.117.1"
    }
  }
}

# Configure the Microsoft Azure Provider
provider "azurerm" {
  features {}
}

# Variables
variable "username" {
  description = "Username prefix for volume tagging"
  type        = string
}

variable "date_suffix" {
  description = "Date suffix in YYYYMMDD format"
  type        = string
  default     = ""
}

variable "sequence_number" {
  description = "Sequence number for the volume"
  type        = string
  default     = "1"
}

variable "resource_group_name" {
  description = "Resource group name"
  type        = string
  default     = "MigrationAsAService-dev-infra"
}

variable "netapp_account_name" {
  description = "NetApp account name"
  type        = string
  default     = "KB-NFS-PERF-AUTO"
}

variable "capacity_pool_name" {
  description = "Capacity pool name"
  type        = string
  default     = "KB-NFS-PERF-AUTO-CP"
}

variable "volume_size_gb" {
  description = "Volume size in GB"
  type        = number
  default     = 1024
}

variable "subnet_id" {
  description = "Subnet ID for ANF volume"
  type        = string
  default     = "/subscriptions/1630c6a9-d99b-498a-aca8-a271f7506bc0/resourceGroups/MigrationAsAService-dev-infra/providers/Microsoft.Network/virtualNetworks/MigrationAsAService-dev-VNET01/subnets/MigrationAsAService-dev-Subnet02"
}

# Local values for dynamic naming
locals {
  # Generate date if not provided
  date_suffix = var.date_suffix != "" ? var.date_suffix : formatdate("YYYYMMDD", timestamp())
  
  # Generate volume name using the convention: vol-dst-perf-YYYYMMDD-N
  volume_name = "vol-dst-perf-${local.date_suffix}-${var.sequence_number}"
  volume_path = "vol-dst-perf-${local.date_suffix}-${var.sequence_number}"
}

# Data sources
data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}

data "azurerm_netapp_account" "main" {
  name                = var.netapp_account_name
  resource_group_name = data.azurerm_resource_group.main.name
}

data "azurerm_netapp_pool" "main" {
  name                = var.capacity_pool_name
  account_name        = data.azurerm_netapp_account.main.name
  resource_group_name = data.azurerm_resource_group.main.name
}

# Delete existing volume if it exists (handled by terraform destroy)
# Create new ANF volume
resource "azurerm_netapp_volume" "main" {
  lifecycle {
    create_before_destroy = false
  }

  name                = local.volume_name
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = data.azurerm_netapp_account.main.name
  pool_name           = data.azurerm_netapp_pool.main.name
  volume_path         = local.volume_path
  service_level       = "Premium"
  subnet_id           = var.subnet_id
  protocols           = ["NFSv3"]
  storage_quota_in_gb = var.volume_size_gb
  security_style      = "unix"

  export_policy_rule {
    rule_index          = 1
    allowed_clients     = ["0.0.0.0/0"]
    protocols_enabled   = ["NFSv3"]
    root_access_enabled = true
    unix_read_write     = true
    unix_read_only      = false
  }

  tags = {
    Environment = "Performance-Test"
    CreatedBy   = "Terraform"
    Username    = var.username
    VolumeSize  = "${var.volume_size_gb}GB"
    DateCreated = local.date_suffix
    Sequence    = var.sequence_number
  }
}

# Outputs
output "volume_id" {
  description = "The ID of the NetApp volume"
  value       = azurerm_netapp_volume.main.id
}

output "volume_name" {
  description = "The name of the NetApp volume"
  value       = azurerm_netapp_volume.main.name
}

output "volume_path" {
  description = "The volume path"
  value       = azurerm_netapp_volume.main.volume_path
}

output "mount_ip_addresses" {
  description = "The mount IP addresses for the volume"
  value       = azurerm_netapp_volume.main.mount_ip_addresses
}

output "export_path" {
  description = "The export path for NFS mounting"
  value       = "/${azurerm_netapp_volume.main.volume_path}"
}

output "destination_host_ip" {
  description = "The primary mount IP address"
  value       = length(azurerm_netapp_volume.main.mount_ip_addresses) > 0 ? azurerm_netapp_volume.main.mount_ip_addresses[0] : ""
}

output "generated_volume_name" {
  description = "The generated volume name with date and sequence"
  value       = local.volume_name
}
