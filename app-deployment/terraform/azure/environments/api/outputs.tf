# Control Plane Outputs
output "control_plane_vm_name" {
  description = "The name of the control plane VM"
  value       = module.control_plane.vm_name
}

output "control_plane_private_ip" {
  description = "The private IP address of the control plane VM"
  value       = module.control_plane.vm_private_ip
}

output "control_plane_admin_password" {
  description = "The admin password for the control plane VM"
  value       = module.control_plane.admin_password
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
    [module.control_plane.vm_name],
    [for worker in module.linux_workers : worker.vm_name],
    [for worker in module.windows_workers : worker.vm_name]
  )
}

output "all_private_ips" {
  description = "All VM private IP addresses"
  value = concat(
    [module.control_plane.vm_private_ip],
    [for worker in module.linux_workers : worker.vm_private_ip],
    [for worker in module.windows_workers : worker.vm_private_ip]
  )
}

output "deployment_summary" {
  description = "Summary of the deployment"
  value = {
    control_plane = {
      name = module.control_plane.vm_name
      ip   = module.control_plane.vm_private_ip
      os   = "linux"
    }
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
