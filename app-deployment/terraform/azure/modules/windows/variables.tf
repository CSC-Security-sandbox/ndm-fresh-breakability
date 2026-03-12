variable "vm_name" {
  description = "The name of the VM"
  type        = string
}

variable "computer_name" {
  description = "The computer name for the Windows VM (max 15 characters)"
  type        = string
  validation {
    condition     = length(var.computer_name) <= 15
    error_message = "Computer name must be 15 characters or less."
  }
}

variable "resource_group" {
  description = "The resource group for the VM deployment"
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

variable "dns_servers" {
  description = "List of DNS servers to use for the NIC."
  type        = list(string)
}

variable "vm_size" {
  description = "The size of the VM"
  type        = string
  default     = "Standard_D4ads_v6"
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

variable "timezone" {
  description = "The timezone for the Windows VM"
  type        = string
  default     = "UTC"
}

variable "enable_automatic_updates" {
  description = "Whether to enable automatic updates"
  type        = bool
  default     = true
}

variable "enable_openssh" {
  description = "Whether to enable OpenSSH on the Windows VM"
  type        = bool
  default     = true
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
