variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region for VM deployment"
  type        = string
}

variable "vm_owner" {
  description = "Owner prefix for VM naming (kept short to stay within GCP 63-char limit)"
  type        = string
}

# Image Configuration
variable "control_plane_image" {
  description = "Full self-link or name of the control plane custom image"
  type        = string
}

variable "worker_image" {
  description = "Full self-link or name of the worker custom image"
  type        = string
}

# VM Sizing
variable "control_plane_machine_type" {
  description = "Machine type for the control plane VM"
  type        = string
  default     = "e2-custom-8-32768"
}

variable "worker_machine_type" {
  description = "Machine type for Linux worker VMs"
  type        = string
  default     = "e2-custom-4-16384"
}

# Admin Credentials
variable "admin_username" {
  description = "Admin username for Windows VMs"
  type        = string
  default     = "datamigrator"
}

variable "admin_password" {
  description = "Admin password for Windows VMs"
  type        = string
  sensitive   = true
  default     = ""
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

# Deployment Scale
variable "linux_worker_count" {
  description = "Number of Linux worker VMs to create"
  type        = number
  default     = 2
}

variable "windows_worker_count" {
  description = "Number of Windows worker VMs to create"
  type        = number
  default     = 2
}

variable "deploy_windows_workers" {
  description = "Whether to deploy Windows workers"
  type        = bool
  default     = true
}

# Windows Image Configuration
variable "windows_image" {
  description = "Windows Server image (family self-link or specific image name)"
  type        = string
  default     = "projects/windows-cloud/global/images/family/windows-2022"
}

variable "windows_worker_machine_type" {
  description = "Machine type for Windows worker VMs"
  type        = string
  default     = "e2-custom-16-65536"
}

# Network Configuration
variable "network" {
  description = "VPC network name"
  type        = string
  default     = "appmicro-vpc1"
}

variable "subnetwork" {
  description = "VPC subnetwork name"
  type        = string
  default     = "appmicro-vpc-subnet-02"
}

variable "enable_gvnic" {
  description = "Enable gVNIC for higher network throughput and lower latency (GCP equivalent of Azure Accelerated Networking)"
  type        = bool
  default     = true
}

variable "dns_servers" {
  description = "Custom DNS servers for Windows VMs to resolve AD domain controller"
  type        = list(string)
  default     = []
}
