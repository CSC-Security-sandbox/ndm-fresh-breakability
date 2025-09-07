variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "app-microservices-cm"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-east4"
}

variable "storage_pool_name" {
  description = "Name of the existing NetApp storage pool"
  type        = string
  default     = "sp-2807-daksh"
}

variable "use_existing_storage_pool" {
  description = "Whether to use existing storage pool"
  type        = bool
  default     = true
}

variable "volume_name_prefix" {
  description = "Prefix for NetApp volume names"
  type        = string
  default     = "vol"
}

variable "share_name_prefix" {
  description = "Prefix for NFS share names"
  type        = string
  default     = "share"
}

variable "volume_count" {
  description = "Number of NetApp volumes to create"
  type        = number
  default     = 2
  
  validation {
    condition     = var.volume_count > 0 && var.volume_count <= 50
    error_message = "Volume count must be between 1 and 50."
  }
}

variable "volume_capacity_gib" {
  description = "Capacity of each NetApp volume in GiB"
  type        = number
  default     = 100
  
  validation {
    condition     = var.volume_capacity_gib >= 100 && var.volume_capacity_gib <= 102400
    error_message = "Volume capacity must be between 100 GiB and 102,400 GiB."
  }
}

variable "protocols" {
  description = "List of protocols for NetApp volumes (NFS only)"
  type        = list(string)
  default     = ["NFSV3"]
  
  validation {
    condition = alltrue([
      for protocol in var.protocols : contains(["NFSV3", "NFSV4"], protocol)
    ])
    error_message = "Protocols must be one or more of: NFSV3, NFSV4."
  }
}

variable "cleanup_existing_volumes" {
  description = "Whether to delete existing volumes with same prefix before creating new ones"
  type        = bool
  default     = false
}

variable "vpc_network" {
  description = "VPC network name for NetApp volumes"
  type        = string
  default     = "appmicro-vpc1"
}

variable "auto_tiering_enabled" {
  description = "Enable auto-tiering for cost optimization"
  type        = bool
  default     = false
}

variable "cooling_threshold_days" {
  description = "Number of days before data is moved to cold tier"
  type        = number
  default     = 30
  
  validation {
    condition     = var.cooling_threshold_days >= 2 && var.cooling_threshold_days <= 183
    error_message = "Cooling threshold must be between 2 and 183 days."
  }
}

variable "security_style" {
  description = "Security style for volumes"
  type        = string
  default     = "UNIX"
  
  validation {
    condition     = contains(["UNIX", "NTFS", "MIXED"], var.security_style)
    error_message = "Security style must be one of: UNIX, NTFS, MIXED."
  }
}

# NFS Export Rules
variable "allowed_clients" {
  description = "Allowed clients for NFS access (CIDR notation)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "access_type" {
  description = "Access type for NFS export"
  type        = string
  default     = "READ_WRITE"
  
  validation {
    condition     = contains(["READ_WRITE", "READ_ONLY"], var.access_type)
    error_message = "Access type must be either READ_WRITE or READ_ONLY."
  }
}

variable "root_access" {
  description = "Enable root access (no_root_squash) for NFS"
  type        = bool
  default     = true
}

variable "environment" {
  description = "Environment label (dev, staging, prod)"
  type        = string
  default     = "dev"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod."
  }
}

variable "block_volume_deletion" {
  description = "Block volume deletion when clients are connected"
  type        = bool
  default     = false
}

variable "volume_labels" {
  description = "Additional labels for volumes"
  type        = map(string)
  default     = {}
}