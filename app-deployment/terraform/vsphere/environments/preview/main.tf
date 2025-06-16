locals {
  cp_vm_name                 = "${var.environment}-${var.developer_name}-control-plane"
  worker_vm_name             = "${var.environment}-${var.developer_name}-linux-worker"
  windows_worker_vm_name     = "${var.environment}-${var.developer_name}-windows-worker"
}

module "control-plane" {
    source                   = "../../modules/linux"
    vm_name                  = local.cp_vm_name
    datacenter_name          = var.datacenter_name
    cluster_name             = var.cluster_name
    datastore_name           = var.datastore_name
    network_name             = var.network_name
    network_interfaces       = var.network_interfaces
    tools_upgrade_policy     = var.tools_upgrade_policy
    ovf_template_name        = var.control_plane_ovf_template_name
    content_library_name     = var.content_library_name
    folder_path              = var.folder_path
    memory_hot_add_enabled   = var.memory_hot_add_enabled
    cpu_hot_add_enabled      = var.cpu_hot_add_enabled
    cpu_hot_remove_enabled   = var.cpu_hot_remove_enabled
    nested_hv_enabled        = var.nested_hv_enabled
    sync_time_with_host      = var.sync_time_with_host
    num_cpus                 = var.control_plane.num_cpus
    num_cores_per_socket     = var.num_cores_per_socket
    memory_mb                = var.control_plane.memory_mb
    disk                     = var.control_plane_disks
}

module "worker" {
    source                   = "../../modules/linux"
    vm_name                  = local.worker_vm_name
    datacenter_name          = var.datacenter_name
    cluster_name             = var.cluster_name
    datastore_name           = var.datastore_name
    network_name             = var.network_name
    network_interfaces       = var.network_interfaces
    tools_upgrade_policy     = var.tools_upgrade_policy
    ovf_template_name        = var.worker_ovf_template_name
    content_library_name     = var.content_library_name
    folder_path              = var.folder_path
    memory_hot_add_enabled   = var.memory_hot_add_enabled
    cpu_hot_add_enabled      = var.cpu_hot_add_enabled
    cpu_hot_remove_enabled   = var.cpu_hot_remove_enabled
    nested_hv_enabled        = var.nested_hv_enabled
    sync_time_with_host      = var.sync_time_with_host
    num_cpus                 = var.worker.num_cpus
    num_cores_per_socket     = var.num_cores_per_socket
    memory_mb                = var.worker.memory_mb
    disk                     = var.worker_disks
}

module "windows-worker" {
    source                   = "../../modules/windows"
    vm_name                  = local.windows_worker_vm_name
    datacenter_name          = var.datacenter_name
    cluster_name             = var.cluster_name
    datastore_name           = var.datastore_name
    network_name             = var.network_name
    network_interfaces       = var.network_interfaces
    tools_upgrade_policy     = var.tools_upgrade_policy
    ovf_template_name        = var.windows_worker_ovf_template_name
    content_library_name     = var.windows_content_library_name
    folder_path              = var.folder_path
    memory_hot_add_enabled   = var.memory_hot_add_enabled
    cpu_hot_add_enabled      = var.cpu_hot_add_enabled
    cpu_hot_remove_enabled   = var.cpu_hot_remove_enabled
    nested_hv_enabled        = var.nested_hv_enabled
    sync_time_with_host      = var.sync_time_with_host
    num_cpus                 = var.worker.num_cpus
    num_cores_per_socket     = var.num_cores_per_socket
    memory_mb                = var.worker.memory_mb
    disk                     = var.worker_disks
}
