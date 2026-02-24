variable "image_version" {
  description = "The image version to use for the control plane. Leave empty to use the latest."
  type        = string
  default     = ""
}

# Generate VM name prefix
variable "vm_name_prefix" {
  description = "The VM name prefix to use for the cp nodes."
  type        = string
  default     = "ubuntu-cp-azure-automated"
}

variable "admin_password" {
  description = "The admin password for the VM ."
  type        = string
}

variable "admin_username" {
  description = "The admin username for the VM."
  type        = string
  default     = "ubuntu"
}

variable "username" {
  description = "Username for VM naming"
  type        = string
}

variable "vm_name" {
  description = "The name of the VM."
  type        = string
  default     = ""
}

variable "resource_group" {
  description = "The resource group for the VM and gallery."
  type        = string
  default     = "MigrationAsAService-dev-infra"
}

variable "vnet_name" {
  description = "The name of the virtual network."
  type        = string
  default     = "MigrationAsAService-dev-VNET02"
}

variable "subnet_name" {
  description = "The name of the subnet."
  type        = string
  default     = "MigrationAsAService-dev-VNET02_Subnet01"
}

variable "gallery_name" {
  description = "The name of the shared image gallery."
  type        = string
  default     = "datamigrator"
}

variable "gallery_resource_group" {
  description = "The resource group where the shared image gallery resides."
  type        = string
  default     = "datamigrate-acr-resource-group"
}

variable "image_definition" {
  description = "The image definition name."
  type        = string
  default     = "ndm-control-plane"
}

