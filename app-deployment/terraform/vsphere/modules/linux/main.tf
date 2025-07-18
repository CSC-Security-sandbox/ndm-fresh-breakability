# Fetch datacenter information
data "vsphere_datacenter" "datacenter" {
  name = var.datacenter_name
}

# Fetch datastore information
data "vsphere_datastore" "datastore" {
  name          = var.datastore_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

# Fetch cluster information
data "vsphere_compute_cluster" "cluster" {
  name          = var.cluster_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

# Fetch network information
data "vsphere_network" "network" {
  name          = var.network_name
  datacenter_id = data.vsphere_datacenter.datacenter.id
}

# Fetch content library information
data "vsphere_content_library" "library" {
  name = var.content_library_name
}

# Fetch OVF template from content library
data "vsphere_content_library_item" "ovf_template" {
  name       = var.ovf_template_name
  library_id = data.vsphere_content_library.library.id
  type       = "ovf"
}


# VM deployment from content library OVF template
resource "vsphere_virtual_machine" "vm" {
  name             = var.vm_name
  folder           = var.folder_path
  resource_pool_id = data.vsphere_compute_cluster.cluster.resource_pool_id
  datastore_id     = data.vsphere_datastore.datastore.id
  firmware         = var.vm_firmware

  # Use the content library OVF template
  clone {
    template_uuid = data.vsphere_content_library_item.ovf_template.id
  }

  # CPU settings
  num_cpus               = var.num_cpus
  num_cores_per_socket   = var.num_cores_per_socket
  cpu_hot_add_enabled    = var.cpu_hot_add_enabled
  cpu_hot_remove_enabled = var.cpu_hot_remove_enabled

  # Memory settings
  memory                 = var.memory_mb
  memory_hot_add_enabled = var.memory_hot_add_enabled

  # Enable nested hardware virtualization for nested hypervisors
  nested_hv_enabled = var.nested_hv_enabled

  # Network settings
  dynamic "network_interface" {
    for_each = var.network_interfaces
    content {
      network_id   = data.vsphere_network.network.id
      adapter_type = network_interface.value.adapter_type
    }
  }

  vapp {
    properties = {
      "ssh_user" = var.ssh_user
      "ssh_pass" = var.ssh_pass
    }
  }

  # Disk settings
  disk {
    label            = var.disk.label
    size             = var.disk.size
    unit_number      = var.disk.unit_number
  }

  # VMware tools sync settings
  sync_time_with_host  = var.sync_time_with_host
  tools_upgrade_policy = var.tools_upgrade_policy
}
