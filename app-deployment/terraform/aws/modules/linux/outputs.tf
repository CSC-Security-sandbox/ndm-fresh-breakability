output "instance_id" {
  description = "The EC2 instance ID"
  value       = aws_instance.vm.id
}

output "vm_private_ip" {
  description = "The private IP address of the instance"
  value       = aws_instance.vm.private_ip
}

output "vm_name" {
  description = "The name tag of the instance"
  value       = var.instance_name
}
