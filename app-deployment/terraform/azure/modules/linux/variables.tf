variable "vm_name" {
  description = "The name of the VM"
  type        = string
}

# Network configuration
variable "vnet_name" {
  description = "The name of the virtual network"
  type        = string
}

variable "subnet_name" {
  description = "The name of the subnet"
  type        = string
}

variable "resource_group" {
  description = "The resource group for the VM deployment"
  type        = string
}

variable "gallery_resource_group" {
  description = "The resource group where the shared image gallery is located"
  type        = string
}

variable "vm_size" {
  description = "The size of the VM"
  type        = string
  default     = "Standard_D8s_v3"
}

variable "admin_username" {
  description = "The admin username for the VM"
  type        = string
}

variable "admin_password" {
  description = "The admin password for the VM"
  type        = string
  sensitive   = true
}

variable "gallery_name" {
  description = "The name of the shared image gallery"
  type        = string
}

variable "image_definition" {
  description = "The image definition name"
  type        = string
}

variable "image_version" {
  description = "The image version to use."
  type        = string
}

variable "os_disk_caching" {
  description = "The caching type for the OS disk"
  type        = string
  default     = "ReadWrite"
}

variable "os_disk_storage_account_type" {
  description = "The storage account type for the OS disk"
  type        = string
  default     = "Premium_LRS"
}

variable "disable_password_authentication" {
  description = "Whether to disable password authentication"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to the VM"
  type        = map(string)
  default     = {}
}

variable "assign_public_ip" {
  description = "Whether to assign a public IP to the VM"
  type        = bool
  default     = false
}

variable "location" {
  description = "The Azure region where resources will be created"
  type        = string
}

variable "accelerated_networking" {
  description = "Enable accelerated networking (SR-IOV) for higher throughput and lower latency"
  type        = bool
  default     = true
}
