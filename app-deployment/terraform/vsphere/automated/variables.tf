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
  default     = "Datacenter"
}

variable "cluster_name" {
  description = "Name of the vSphere cluster"
  type        = string
  default     = "NDMCluster"
}

variable "datastore_name" {
  description = "Name of the vSphere datastore"
  type        = string
  default     = "datastore"
}

variable "network_name" {
  description = "Name of the vSphere network"
  type        = string
  default     = "VM Network"
}

# Content library variables
variable "content_library_name" {
  description = "Name of the content library containing the OVF template"
  type        = string
  default     = "datamigrator-ovf-builds"
}

# Template names
variable "control_plane_ovf_template_name" {
  description = "Control plane OVF template name from content library"
  type        = string
}

variable "worker_ovf_template_name" {
  description = "Worker OVF template name from content library"
  type        = string
}

# VM hardware variables
variable "num_cores_per_socket" {
  description = "Number of cores per socket"
  type        = number
  default     = 1
}

variable "cpu_hot_add_enabled" {
  description = "Enable CPU hot add"
  type        = bool
  default     = false
}

variable "cpu_hot_remove_enabled" {
  description = "Enable CPU hot remove"
  type        = bool
  default     = false
}

variable "memory_hot_add_enabled" {
  description = "Enable memory hot add"
  type        = bool
  default     = false
}

variable "nested_hv_enabled" {
  description = "Enable nested hardware virtualization"
  type        = bool
  default     = false
}

# Network interface configuration
variable "network_interfaces" {
  description = "Network interface configuration"
  type = list(object({
    adapter_type = string
  }))
  default = [
    {
      adapter_type = "vmxnet3"
    }
  ]
}

# VM customization and tools settings
variable "sync_time_with_host" {
  description = "Sync VM time with host"
  type        = bool
  default     = true
}

variable "tools_upgrade_policy" {
  description = "VMware tools upgrade policy"
  type        = string
  default     = "manual"
}

# Worker count
variable "worker_count" {
  description = "Number of worker VMs to create"
  type        = number
}

# Control plane configuration
variable "control_plane" {
  description = "Control plane VM configuration"
  type = object({
    num_cpus  = number
    memory_mb = number
  })
  default = {
    num_cpus  = 8
    memory_mb = 32768
  }
}

# Worker configuration
variable "worker" {
  description = "Worker VM configuration"
  type = object({
    num_cpus  = number
    memory_mb = number
  })
  default = {
    num_cpus  = 4
    memory_mb = 16384
  }
}

# Control plane disk configuration
variable "control_plane_disks" {
  description = "Control plane disk configuration"
  type = object({
    label       = string
    size        = number
    unit_number = number
  })
  default = {
    label       = "disk0"
    size        = 1024
    unit_number = 0
  }
}

# Worker disk configuration
variable "worker_disks" {
  description = "Worker disk configuration"
  type = object({
    label       = string
    size        = number
    unit_number = number
  })
  default = {
    label       = "disk0"
    size        = 100
    unit_number = 0
  }
}

# SSH configuration
variable "ssh_username" {
  description = "SSH username for VM access"
  type        = string
  default     = "ubuntu"
}

variable "ssh_password" {
  description = "SSH password for VM access"
  type        = string
  sensitive   = true
}

# Power on setting
variable "power_on" {
  description = "Power on VMs after creation"
  type        = bool
  default     = true
}

variable "cp_vm_name" {
  description = "Control plane VM name"
  type        = string
  default     = "cp-automated-api"
}

variable "wk_vm_name" {
  description = "Worker VM name prefix"
  type        = string
  default     = "worker-automated-api"
}