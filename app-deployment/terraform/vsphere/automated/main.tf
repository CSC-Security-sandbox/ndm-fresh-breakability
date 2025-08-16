terraform {
  required_providers {
    vsphere = {
      source  = "vmware/vsphere"
      version = "~> 2.4"
    }
  }
}

provider "vsphere" {
  user                 = var.vsphere_user
  password             = var.vsphere_password
  vsphere_server       = var.vsphere_server
  allow_unverified_ssl = true
}

# Data sources for vSphere infrastructure
data "vsphere_datacenter" "datacenter" {
  name = var.datacenter_name
}

data "vsphere_compute_cluster" "cluster" {
  name          = var.cluster_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

data "vsphere_datastore" "datastore" {
  name          = var.datastore_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

data "vsphere_network" "network" {
  name          = var.network_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

data "vsphere_content_library" "library" {
  name = var.content_library_name
}

# Control plane template
data "vsphere_content_library_item" "control_plane_template" {
  name       = var.control_plane_ovf_template_name
  library_id = data.vsphere_content_library.library.id
  type       = "ovf"
}

# Worker template  
data "vsphere_content_library_item" "worker_template" {
  name       = var.worker_ovf_template_name
  library_id = data.vsphere_content_library.library.id
  type       = "ovf"
}

# Control plane VM
resource "vsphere_virtual_machine" "control_plane_vm" {
  name = var.cp_vm_name
  # folder           = var.folder_path
  resource_pool_id = data.vsphere_compute_cluster.cluster.resource_pool_id
  datastore_id     = data.vsphere_datastore.datastore.id
  firmware         = "efi"

  # CPU settings
  num_cpus               = var.control_plane.num_cpus
  num_cores_per_socket   = var.num_cores_per_socket
  cpu_hot_add_enabled    = var.cpu_hot_add_enabled
  cpu_hot_remove_enabled = var.cpu_hot_remove_enabled

  # Memory settings
  memory                 = var.control_plane.memory_mb
  memory_hot_add_enabled = var.memory_hot_add_enabled

  # Other settings
  nested_hv_enabled    = var.nested_hv_enabled
  sync_time_with_host  = var.sync_time_with_host
  tools_upgrade_policy = var.tools_upgrade_policy

  # Network settings
  dynamic "network_interface" {
    for_each = var.network_interfaces
    content {
      network_id   = data.vsphere_network.network.id
      adapter_type = network_interface.value.adapter_type
    }
  }

  # Disk settings
  disk {
    label       = var.control_plane_disks.label
    size        = var.control_plane_disks.size
    unit_number = var.control_plane_disks.unit_number
  }

  clone {
    template_uuid = data.vsphere_content_library_item.control_plane_template.id
  }

  vapp {
    properties = {
      "ssh_user" = var.ssh_username
      "ssh_pass" = var.ssh_password
    }
  }
}

# Worker VMs (create 3 by default)
resource "vsphere_virtual_machine" "worker_vms" {
  count = var.worker_count
  name  = "${var.wk_vm_name}-${count.index + 1}"
  # folder           = var.folder_path
  resource_pool_id = data.vsphere_compute_cluster.cluster.resource_pool_id
  datastore_id     = data.vsphere_datastore.datastore.id
  firmware         = "efi"

  # CPU settings
  num_cpus               = var.worker.num_cpus
  num_cores_per_socket   = var.num_cores_per_socket
  cpu_hot_add_enabled    = var.cpu_hot_add_enabled
  cpu_hot_remove_enabled = var.cpu_hot_remove_enabled

  # Memory settings
  memory                 = var.worker.memory_mb
  memory_hot_add_enabled = var.memory_hot_add_enabled

  # Other settings
  nested_hv_enabled    = var.nested_hv_enabled
  sync_time_with_host  = var.sync_time_with_host
  tools_upgrade_policy = var.tools_upgrade_policy

  # Network settings
  dynamic "network_interface" {
    for_each = var.network_interfaces
    content {
      network_id   = data.vsphere_network.network.id
      adapter_type = network_interface.value.adapter_type
    }
  }

  # Disk settings
  disk {
    label       = var.worker_disks.label
    size        = var.worker_disks.size
    unit_number = var.worker_disks.unit_number
  }

  clone {
    template_uuid = data.vsphere_content_library_item.worker_template.id
  }

  vapp {
    properties = {
      "ssh_user" = var.ssh_username
      "ssh_pass" = var.ssh_password
    }
  }
}
