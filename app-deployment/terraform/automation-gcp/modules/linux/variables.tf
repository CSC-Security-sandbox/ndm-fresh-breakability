variable "vm_name" {
  description = "The name of the VM"
  type        = string
}

variable "machine_type" {
  description = "The machine type for the VM"
  type        = string
  default     = "e2-custom-8-32768"
}

variable "zone" {
  description = "The GCP zone to deploy the VM in"
  type        = string
}

variable "image" {
  description = "The source image (self-link or name) for the boot disk"
  type        = string
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
  default     = ["http-server"]
}

# Disk configuration
variable "disk_size_gb" {
  description = "The size of the boot disk in GB"
  type        = number
  default     = 200
}

variable "disk_type" {
  description = "The type of the boot disk (pd-standard, pd-ssd, pd-balanced)"
  type        = string
  default     = "pd-ssd"
}

# Admin credentials for SSH password authentication
variable "admin_username" {
  description = "Admin username to create on the VM for SSH access"
  type        = string
  default     = ""
}

variable "admin_password" {
  description = "Admin password for SSH access"
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_ssh_public_key" {
  description = "SSH public key for admin user (pushed via instance metadata)"
  type        = string
  default     = ""
}

variable "admin_ssh_private_key" {
  description = "SSH private key content for provisioner connection"
  type        = string
  default     = ""
  sensitive   = true
}

# Startup script
variable "startup_script" {
  description = "Startup script to run on boot"
  type        = string
  default     = ""
}

# Labels (GCP equivalent of Azure tags)
variable "labels" {
  description = "Labels to apply to the VM"
  type        = map(string)
  default     = {}
}
