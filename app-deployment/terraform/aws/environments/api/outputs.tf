# Control Plane Outputs
output "control_plane_instance_id" {
  description = "The EC2 instance ID of the control plane"
  value       = module.control_plane.instance_id
}

output "control_plane_private_ip" {
  description = "The private IP address of the control plane"
  value       = module.control_plane.vm_private_ip
}

output "control_plane_vm_name" {
  description = "The name tag of the control plane instance"
  value       = module.control_plane.vm_name
}

# Linux Workers Outputs
output "linux_worker_instance_ids" {
  description = "The EC2 instance IDs of the Linux workers"
  value       = [for w in module.linux_workers : w.instance_id]
}

output "linux_worker_private_ips" {
  description = "The private IP addresses of the Linux worker instances"
  value       = [for w in module.linux_workers : w.vm_private_ip]
}

output "linux_worker_vm_names" {
  description = "The name tags of the Linux worker instances"
  value       = [for w in module.linux_workers : w.vm_name]
}

# Windows Workers Outputs
output "windows_worker_instance_ids" {
  description = "The EC2 instance IDs of the Windows workers"
  value       = [for w in module.windows_workers : w.instance_id]
}

output "windows_worker_private_ips" {
  description = "The private IP addresses of the Windows worker instances"
  value       = [for w in module.windows_workers : w.vm_private_ip]
}

output "windows_worker_vm_names" {
  description = "The name tags of the Windows worker instances"
  value       = [for w in module.windows_workers : w.vm_name]
}

# Summary
output "deployment_summary" {
  description = "Summary of the AWS deployment"
  value = {
    control_plane = {
      name = module.control_plane.vm_name
      ip   = module.control_plane.vm_private_ip
      os   = "linux"
    }
    linux_workers = [
      for i, w in module.linux_workers : {
        name      = w.vm_name
        ip        = w.vm_private_ip
        os        = "linux"
        worker_id = i + 1
      }
    ]
    windows_workers = [
      for i, w in module.windows_workers : {
        name      = w.vm_name
        ip        = w.vm_private_ip
        os        = "windows"
        worker_id = i + 1
      }
    ]
  }
}
