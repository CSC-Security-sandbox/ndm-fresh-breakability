# Output the VM's IP address and ID for reference
output "vm_ip_address" {
  description = "The IP address of the deployed virtual machine"
  value       = vsphere_virtual_machine.vm.default_ip_address
}

output "vm_id" {
  description = "The ID of the deployed virtual machine"
  value       = vsphere_virtual_machine.vm.id
}

output "vm_name" {
  description = "The name of the deployed virtual machine"
  value       = vsphere_virtual_machine.vm.name
}

output "vm_uuid" {
  description = "The UUID of the deployed virtual machine"
  value       = vsphere_virtual_machine.vm.uuid
}

output "guest_ip_addresses" {
  description = "All IP addresses reported by the guest"
  value       = vsphere_virtual_machine.vm.guest_ip_addresses
}
