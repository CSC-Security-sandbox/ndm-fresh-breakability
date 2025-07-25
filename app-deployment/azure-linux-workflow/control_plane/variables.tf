variable "image_version" {
  description = "The image version to use for the control plane. Leave empty to use the latest."
  type        = string
  default     = ""
}

# Generate timestamp and random suffix for unique VM naming
locals {
  timestamp = formatdate("YYYYMMDD-hhmmss", timestamp())
  random_suffix = random_id.unique_suffix.hex
}

resource "random_id" "unique_suffix" {
  byte_length = 3
}

variable "admin_password" {
  description = "The admin password for the VM ."
  type        = string
  default     = "Password@123"
}

variable "admin_username" {
  description = "The admin username for the VM."
  type        = string
  default     = "ubuntu"
}

variable "vm_name" {
  description = "The name of the VM."
  type        = string
  default     = "ndm-control-plane"
}

variable "resource_group" {
  description = "The resource group for the VM and gallery."
  type        = string
  default     = "datamigrate-acr-resource-group"
}

variable "vnet_name" {
  description = "The name of the virtual network."
  type        = string
  default     = "datamigrate-dev-vnet"
}

variable "subnet_name" {
  description = "The name of the subnet."
  type        = string
  default     = "default"
}

variable "gallery_name" {
  description = "The name of the shared image gallery."
  type        = string
  default     = "datamigrator"
}

variable "image_definition" {
  description = "The image definition name."
  type        = string
  default     = "ndm-control-plane"
}
