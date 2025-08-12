output "vm_id" {
  description = "The ID of the VM"
  value       = azurerm_linux_virtual_machine.vm.id
}

output "vm_name" {
  description = "The name of the VM"
  value       = azurerm_linux_virtual_machine.vm.name
}

output "vm_private_ip" {
  description = "The private IP address of the VM"
  value       = azurerm_network_interface.nic.private_ip_address
}

output "vm_public_ip" {
  description = "The public IP address of the VM (if assigned)"
  value       = var.assign_public_ip ? azurerm_public_ip.public_ip[0].ip_address : null
}

output "admin_username" {
  description = "The admin username for the VM"
  value       = azurerm_linux_virtual_machine.vm.admin_username
}

output "admin_password" {
  description = "The admin password for the VM"
  value       = var.admin_password
  sensitive   = true
}

output "network_interface_id" {
  description = "The ID of the network interface"
  value       = azurerm_network_interface.nic.id
}
