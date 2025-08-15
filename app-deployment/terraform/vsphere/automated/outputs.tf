# Control plane VM outputs
output "control_plane_vm" {
  description = "Control plane VM details"
  value = {
    name      = vsphere_virtual_machine.control_plane_vm.name
    uuid      = vsphere_virtual_machine.control_plane_vm.uuid
    moid      = vsphere_virtual_machine.control_plane_vm.moid
    num_cpus  = vsphere_virtual_machine.control_plane_vm.num_cpus
    memory    = vsphere_virtual_machine.control_plane_vm.memory
    ipaddress = vsphere_virtual_machine.control_plane_vm.default_ip_address
  }
}

# Worker VMs outputs
output "worker_vms" {
  description = "Worker VMs details"
  value = {
    for i, vm in vsphere_virtual_machine.worker_vms : "worker-${i + 1}" => {
      name      = vm.name
      uuid      = vm.uuid
      moid      = vm.moid
      num_cpus  = vm.num_cpus
      memory    = vm.memory
      ipaddress = vm.default_ip_address
    }
  }
}

# Summary
output "deployment_summary" {
  description = "Deployment summary"
  value = {
    control_plane_count = 1
    worker_count        = var.worker_count
    total_vms           = 1 + var.worker_count
    control_plane_name  = vsphere_virtual_machine.control_plane_vm.name
    worker_names        = [for vm in vsphere_virtual_machine.worker_vms : vm.name]
  }
}
