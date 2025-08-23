variable "control_plane_image_version" {
  description = "The image version to use for the control plane."
  type        = string
}

variable "worker_image_version" {
  description = "The image version to use for Linux workers."
  type        = string
}

variable "admin_username" {
  description = "The admin username for the VM."
  type        = string
  default     = "datamigrator"
}

variable "admin_password" {
  description = "The admin password for the VM."
  type        = string
}

variable "vm_owner" {
  description = "Username for VM naming"
  type        = string
}

variable "resource_group" {
  description = "The resource group for Linux VM deployment."
  type        = string
  default     = "MigrationAsAService-dev-infra"
}

variable "gallery_resource_group" {
  description = "The resource group where the shared image gallery is located."
  type        = string
  default     = "datamigrate-acr-resource-group"
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

variable "control_plane_image_definition" {
  description = "The image definition name."
  type        = string
  default     = "ndm-control-plane"
}

variable "worker_image_definition" {
  description = "The worker image definition name."
  type        = string
  default     = "ndm-worker"
}

# Windows Marketplace Image Configuration
variable "windows_image_publisher" {
  description = "The publisher of the Windows marketplace image"
  type        = string
  default     = "MicrosoftWindowsServer"
}

variable "windows_image_offer" {
  description = "The offer of the Windows marketplace image"
  type        = string
  default     = "WindowsServer"
}

variable "windows_image_sku" {
  description = "The SKU of the Windows marketplace image"
  type        = string
  default     = "2022-datacenter"
}

variable "windows_image_version" {
  description = "The version of the Windows marketplace image"
  type        = string
  default     = "latest"
}

variable "linux_worker_count" {
  description = "Number of Linux worker nodes to create"
  type        = number
  default     = 2
}

variable "windows_worker_count" {
  description = "Number of Windows worker nodes to create"
  type        = number
  default     = 2
}

variable "deploy_windows_workers" {
  description = "Whether to deploy Windows workers"
  type        = bool
  default     = true
}

variable "worker_vm_size" {
  description = "The VM size for worker nodes"
  type        = string
  default     = "Standard_D4ads_v6"
}

variable "control_plane_vm_size" {
  description = "The VM size for control plane"
  type        = string
  default     = "Standard_D8ads_v6"
}

variable "location" {
  description = "The Azure region where resources will be created"
  type        = string
}
