variable "instance_name" {
  description = "Name tag for the EC2 instance"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID where the instance will be launched"
  type        = string
}

variable "security_group_id" {
  description = "Security group ID to attach to the instance"
  type        = string
}

variable "key_name" {
  description = "EC2 key pair name — used to encrypt the initial Administrator password"
  type        = string
}

variable "admin_username" {
  description = "Windows service account username to create (used by downstream SSH/SCP steps)"
  type        = string
  default     = "datamigrator"
}

variable "admin_password" {
  description = "Password to set for the administrator account via user_data"
  type        = string
  sensitive   = true
}

variable "dns_servers" {
  description = "List of AD DNS server IPs to set on the NIC at boot. Required on AWS (VPC resolver cannot resolve the AD domain). Leave empty to skip."
  type        = list(string)
  default     = []
}

variable "root_volume_size" {
  description = "Size of the root EBS volume in GB"
  type        = number
  default     = 100
}

variable "tags" {
  description = "Tags to apply to the instance"
  type        = map(string)
  default     = {}
}
