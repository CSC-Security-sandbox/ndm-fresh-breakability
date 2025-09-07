variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "selected_zone" {
  description = "Specific zone to deploy all instances (validated by run.sh)"
  type        = string
  default     = ""
}

variable "vm_count" {
  description = "Number of VMs to create"
  type        = number
}

variable "name_prefix" {
  description = "Prefix for VM names"
  type        = string
}

variable "machine_types" {
  description = "List of machine types for each VM"
  type        = list(string)
}

variable "images" {
  description = "List of custom images for each VM"
  type        = list(string)
}

variable "control_plane_count" {
  type = number
}

variable "worker_count" {
  type = number
}

variable "instance_names" {
  type = list(string)
}

variable "subnetwork" {
  description = "Subnetwork to deploy instances"
  type        = string
  default     = ""
}
