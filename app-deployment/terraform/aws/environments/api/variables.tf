variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "aws_access_key" {
  description = "AWS IAM access key"
  type        = string
  sensitive   = true
}

variable "aws_secret_key" {
  description = "AWS IAM secret key"
  type        = string
  sensitive   = true
}

variable "key_name" {
  description = "EC2 key pair name for SSH access to Linux/CP instances"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID where instances will be launched"
  type        = string
  default     = "subnet-0c9a53ce5ee64c369"
}

variable "security_group_id" {
  description = "Security group ID to attach to all instances"
  type        = string
  default     = "sg-019054b93bf4e8941"
}

variable "control_plane_ami_id" {
  description = "AMI ID for the control plane instance"
  type        = string
}

variable "linux_worker_ami_id" {
  description = "AMI ID for Linux worker instances"
  type        = string
}

variable "admin_username" {
  description = "SSH username baked into the Linux/CP AMIs"
  type        = string
  default     = "ubuntu"
}

variable "admin_password" {
  description = "Password to set on all VMs post-provision (reused from NDM_SSH_PASSWORD)"
  type        = string
  sensitive   = true
}

variable "vm_owner" {
  description = "Short prefix for VM name tags (kept compact for readability)"
  type        = string
}

variable "control_plane_instance_type" {
  description = "EC2 instance type for the control plane"
  type        = string
  default     = "m5.2xlarge"
}

variable "linux_worker_instance_type" {
  description = "EC2 instance type for Linux workers"
  type        = string
  default     = "m5.xlarge"
}

variable "windows_worker_instance_type" {
  description = "EC2 instance type for Windows workers"
  type        = string
  default     = "m5.4xlarge"
}

variable "linux_worker_count" {
  description = "Number of Linux worker instances to create"
  type        = number
  default     = 2
}

variable "windows_worker_count" {
  description = "Number of Windows worker instances to create"
  type        = number
  default     = 2
}

variable "deploy_windows_workers" {
  description = "Whether to deploy Windows worker instances"
  type        = bool
  default     = true
}

variable "control_plane_root_volume_size" {
  description = "Root EBS volume size in GB for the control plane"
  type        = number
  default     = 200
}

variable "linux_worker_root_volume_size" {
  description = "Root EBS volume size in GB for Linux workers"
  type        = number
  default     = 100
}

variable "windows_worker_root_volume_size" {
  description = "Root EBS volume size in GB for Windows workers"
  type        = number
  default     = 100
}
