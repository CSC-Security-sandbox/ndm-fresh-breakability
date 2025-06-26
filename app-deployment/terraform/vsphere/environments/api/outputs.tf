output "control_plane_vm_ip_address" {
  description = "The IP address of the control-plane virtual machine"
  value       = module.control-plane.vm_ip_address
}

output "control_plane_vm_name" {
  description = "The name of the control-plane virtual machine"
  value       = module.control-plane.vm_name
}

output "control_plane_vm_uuid" {
  description = "The UUID of the control-plane virtual machine"
  value       = module.control-plane.vm_uuid
}

output "worker_vm_ip_addresses" {
  description = "The IP addresses of the worker virtual machines"
  value       = [for w in module.worker : w.vm_ip_address]
}

output "worker_vm_names" {
  description = "The names of the worker virtual machines"
  value       = [for w in module.worker : w.vm_name]
}

output "worker_vm_uuids" {
  description = "The UUIDs of the worker virtual machines"
  value       = [for w in module.worker : w.vm_uuid]
}
