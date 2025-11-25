# Control Plane Outputs
output "control_plane_vm_names" {
  description = "The names of the control plane VMs"
  value       = [for cp in module.control_plane : cp.vm_name]
}

output "control_plane_private_ip" {
  description = "The private IP address of the first control plane VM (for backward compatibility)"
  value       = length(module.control_plane) > 0 ? module.control_plane[0].vm_private_ip : ""
}

output "control_plane_private_ips" {
  description = "The private IP addresses of all control plane VMs"
  value       = [for cp in module.control_plane : cp.vm_private_ip]
}

output "control_plane_admin_passwords" {
  description = "The admin passwords for the control plane VMs"
  value       = [for cp in module.control_plane : cp.admin_password]
  sensitive   = true
}

# Linux Workers Outputs
output "linux_worker_vm_names" {
  description = "The names of the Linux worker VMs"
  value       = [for worker in module.linux_workers : worker.vm_name]
}

output "linux_worker_private_ips" {
  description = "The private IP addresses of the Linux worker VMs"
  value       = [for worker in module.linux_workers : worker.vm_private_ip]
}

output "linux_worker_admin_passwords" {
  description = "The admin passwords for the Linux worker VMs"
  value       = [for worker in module.linux_workers : worker.admin_password]
  sensitive   = true
}

# Windows Workers Outputs
output "windows_worker_vm_names" {
  description = "The names of the Windows worker VMs"
  value       = [for worker in module.windows_workers : worker.vm_name]
}

output "windows_worker_private_ips" {
  description = "The private IP addresses of the Windows worker VMs"
  value       = [for worker in module.windows_workers : worker.vm_private_ip]
}

output "windows_worker_admin_passwords" {
  description = "The admin passwords for the Windows worker VMs"
  value       = [for worker in module.windows_workers : worker.admin_password]
  sensitive   = true
}

# Summary Outputs
output "all_vm_names" {
  description = "All VM names"
  value = concat(
    [for cp in module.control_plane : cp.vm_name],
    [for worker in module.linux_workers : worker.vm_name],
    [for worker in module.windows_workers : worker.vm_name]
  )
}

output "all_private_ips" {
  description = "All VM private IP addresses"
  value = concat(
    [for cp in module.control_plane : cp.vm_private_ip],
    [for worker in module.linux_workers : worker.vm_private_ip],
    [for worker in module.windows_workers : worker.vm_private_ip]
  )
}

output "deployment_summary" {
  description = "Summary of the deployment"
  value = {
    control_planes = [
      for i, cp in module.control_plane : {
        name  = cp.vm_name
        ip    = cp.vm_private_ip
        os    = "linux"
        cp_id = i + 1
      }
    ]
    linux_workers = [
      for i, worker in module.linux_workers : {
        name      = worker.vm_name
        ip        = worker.vm_private_ip
        os        = "linux"
        worker_id = i + 1
      }
    ]
    windows_workers = [
      for i, worker in module.windows_workers : {
        name      = worker.vm_name
        ip        = worker.vm_private_ip
        os        = "windows"
        worker_id = i + 1
      }
    ]
  }
}
