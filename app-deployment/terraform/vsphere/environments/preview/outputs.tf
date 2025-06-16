# Environment-specific outputs for the preview environment
output "environment" {
  description = "The name of the environment"
  value       = var.environment
}

output "environment_owner" {
  description = "The owner of the environment"
  value       = var.developer_name
}

# Outputs for the control-plane module
output "control_plane_vm_ip_address" {
  description = "The IP address of the control-plane virtual machine"
  value       = module.control-plane.vm_ip_address
}

output "control_plane_vm_id" {
  description = "The ID of the control-plane virtual machine"
  value       = module.control-plane.vm_id
}

output "control_plane_vm_name" {
  description = "The name of the control-plane virtual machine"
  value       = module.control-plane.vm_name
}

output "control_plane_vm_uuid" {
  description = "The UUID of the control-plane virtual machine"
  value       = module.control-plane.vm_uuid
}

output "control_plane_guest_ip_addresses" {
  description = "All IP addresses reported by the guest for the control-plane VM"
  value       = module.control-plane.guest_ip_addresses
}

# Outputs for the worker module
output "worker_vm_ip_address" {
  description = "The IP address of the worker virtual machine"
  value       = module.worker.vm_ip_address
}

output "worker_vm_id" {
  description = "The ID of the worker virtual machine"
  value       = module.worker.vm_id
}

output "worker_vm_name" {
  description = "The name of the worker virtual machine"
  value       = module.worker.vm_name
}

output "worker_vm_uuid" {
  description = "The UUID of the worker virtual machine"
  value       = module.worker.vm_uuid
}

output "worker_guest_ip_addresses" {
  description = "All IP addresses reported by the guest for the worker VM"
  value       = module.worker.guest_ip_addresses
}

# Outputs for the windows-worker module
output "windows_worker_vm_ip_address" {
  description = "The IP address of the Windows worker virtual machine"
  value       = module.windows-worker.vm_ip_address
}

output "windows_worker_vm_id" {
  description = "The ID of the Windows worker virtual machine"
  value       = module.windows-worker.vm_id
}

output "windows_worker_vm_name" {
  description = "The name of the Windows worker virtual machine"
  value       = module.windows-worker.vm_name
}

output "windows_worker_vm_uuid" {
  description = "The UUID of the Windows worker virtual machine"
  value       = module.windows-worker.vm_uuid
}

output "windows_worker_guest_ip_addresses" {
  description = "All IP addresses reported by the guest for the Windows worker VM"
  value       = module.windows-worker.guest_ip_addresses
}