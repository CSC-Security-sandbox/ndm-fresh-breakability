output "vm_id" {
  description = "The ID of the VM"
  value       = google_compute_instance.vm.id
}

output "vm_name" {
  description = "The name of the VM"
  value       = google_compute_instance.vm.name
}

output "vm_private_ip" {
  description = "The private IP address of the VM"
  value       = google_compute_instance.vm.network_interface[0].network_ip
}

output "vm_public_ip" {
  description = "The external IP address of the VM (if assigned)"
  value       = var.assign_public_ip ? google_compute_instance.vm.network_interface[0].access_config[0].nat_ip : null
}

output "vm_zone" {
  description = "The zone the VM is deployed in"
  value       = google_compute_instance.vm.zone
}

output "vm_self_link" {
  description = "The self link of the VM"
  value       = google_compute_instance.vm.self_link
}
