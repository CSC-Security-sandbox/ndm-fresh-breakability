variable "vm_name" {
  description = "The name of the VM"
  type        = string
}

variable "machine_type" {
  description = "The machine type for the VM"
  type        = string
  default     = "e2-custom-16-65536"
}

variable "zone" {
  description = "The GCP zone to deploy the VM in"
  type        = string
}

variable "image" {
  description = "The Windows Server image (family self-link or specific image name)"
  type        = string
  default     = "projects/windows-cloud/global/images/family/windows-2022"
}

# Network configuration
variable "network" {
  description = "VPC network name"
  type        = string
}

variable "subnetwork" {
  description = "VPC subnetwork name"
  type        = string
}

variable "enable_gvnic" {
  description = "Enable gVNIC for higher network throughput and lower latency"
  type        = bool
  default     = true
}

variable "assign_public_ip" {
  description = "Whether to assign an external IP to the VM"
  type        = bool
  default     = false
}

variable "network_tags" {
  description = "Network tags to apply to the VM"
  type        = list(string)
  default     = ["http-server", "rdp-server"]
}

# Disk configuration
variable "disk_size_gb" {
  description = "The size of the boot disk in GB"
  type        = number
  default     = 100
}

variable "disk_type" {
  description = "The type of the boot disk (pd-standard, pd-ssd, pd-balanced)"
  type        = string
  default     = "pd-ssd"
}

# Admin credentials — set via startup script
variable "admin_username" {
  description = "Admin username to configure on the Windows VM"
  type        = string
}

variable "admin_password" {
  description = "Admin password to configure on the Windows VM"
  type        = string
  sensitive   = true
}

variable "dns_servers" {
  description = "Custom DNS servers for AD domain resolution (applied via Set-DnsClientServerAddress)"
  type        = list(string)
  default     = []
}

variable "enable_openssh" {
  description = "Whether to install and configure OpenSSH Server on the Windows VM"
  type        = bool
  default     = true
}

# Labels (GCP equivalent of Azure tags)
variable "labels" {
  description = "Labels to apply to the VM"
  type        = map(string)
  default     = {}
}
