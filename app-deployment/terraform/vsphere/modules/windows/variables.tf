# Environment variables
variable "vm_name" {
  description = "Name of the virtual machine to be deployed"
  type        = string
}

# vSphere infrastructure variables
variable "datacenter_name" {
  description = "Name of the vSphere datacenter"
  type        = string
}

variable "cluster_name" {
  description = "Name of the vSphere cluster"
  type        = string
}

variable "datastore_name" {
  description = "Name of the vSphere datastore to deploy the VM on"
  type        = string
}

variable "network_name" {
  description = "Name of the vSphere network to attach to the VM"
  type        = string
}

variable "folder_path" {
  description = "Path of the folder to place the VM in. Example: 'vm/Test VMs'"
  type        = string
}

# Content library variables
variable "content_library_name" {
  description = "Name of the content library containing the OVF template"
  type        = string
}

variable "ovf_template_name" {
  description = "Name of the OVF template in the content library"
  type        = string
}

# VM hardware variables
variable "num_cpus" {
  description = "Number of CPUs for the VM"
  type        = number
}

variable "num_cores_per_socket" {
  description = "Number of cores per CPU socket"
  type        = number
}

variable "memory_mb" {
  description = "Amount of memory in MB"
  type        = number
}

variable "cpu_hot_add_enabled" {
  description = "Enable CPU hot add"
  type        = bool
}

variable "cpu_hot_remove_enabled" {
  description = "Enable CPU hot remove"
  type        = bool
}

variable "memory_hot_add_enabled" {
  description = "Enable memory hot add"
  type        = bool
}

variable "nested_hv_enabled" {
  description = "Enable nested hardware virtualization (for nested hypervisors)"
  type        = bool
}

# Network interface configuration
variable "network_interfaces" {
  description = "List of network interfaces for the VM"
  type = list(object({
    adapter_type = string
  }))
}

# VM customization and tools settings
variable "sync_time_with_host" {
  description = "Sync VM time with host"
  type        = bool
}

variable "tools_upgrade_policy" {
  description = "Tools upgrade policy. Options: manual, upgradeAtPowerCycle"
  type        = string
}

# VM settings
variable "vm_firmware" {
  type        = string
  description = "The virtual machine firmware."
  default     = "efi"
}

# VM disk settings
variable "disk" {
  description = "Configuration for the disk of the virtual machine"
  type = object({
    label       = string
    size        = number
    unit_number = number
  })
}