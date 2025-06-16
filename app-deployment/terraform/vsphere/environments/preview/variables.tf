# Environment variables
variable "environment" {
  description = "Environment name (e.g., preview1, preview2)"
  type        = string
}

variable "developer_name" {
  description = "Developer name for the VM"
  type        = string
}

# vSphere connection variables
variable "vsphere_server" {
  description = "vSphere server hostname or IP address"
  type        = string
}

variable "vsphere_user" {
  description = "vSphere username"
  type        = string
}

variable "vsphere_password" {
  description = "vSphere password"
  type        = string
  sensitive   = true
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

variable "control_plane_ovf_template_name" {
  description = "Name of the OVF template in the content library for control plane"
  type        = string
}

variable "worker_ovf_template_name" {
  description = "Name of the OVF template in the content library for worker"
  type        = string
}

variable "windows_worker_ovf_template_name" {
  description = "Name of the OVF template in the content library for windows worker"
  type        = string
}

variable "windows_content_library_name" {
  description = "Name of the content library containing the OVF template"
  type        = string
}

# VM hardware variables
variable "num_cores_per_socket" {
  description = "Number of cores per CPU socket"
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

# Component specific variables
variable "control_plane" {
  description = "Configuration for the control plane component"
  type = object({
    num_cpus   = number
    memory_mb  = number
  })
}

variable "worker" {
  description = "Configuration for the worker component"
  type = object({
    num_cpus   = number
    memory_mb  = number
  })
}

# VM disk settings
variable "worker_disks" {
  description = "Configuration for the disk of the virtual machine"
  type = object({
    label       = string
    size        = number
    unit_number = optional(number)
  })
}

variable "control_plane_disks" {
  description = "Configuration for the disk of the virtual machine"
  type = object({
    label       = string
    size        = number
    unit_number = optional(number)
  })
}