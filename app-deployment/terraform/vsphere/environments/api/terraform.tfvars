# vSphere infrastructure variables
datacenter_name  = "Datacenter"
cluster_name     = "NDMCluster"
datastore_name   = "datastore"
network_name     = "VM Network"
folder_path      = "ova-build"

# Content library variables
content_library_name = "datamigrator-ovf-builds"

# VM hardware variables
num_cores_per_socket   = 1
cpu_hot_add_enabled    = false
cpu_hot_remove_enabled = false
memory_hot_add_enabled = false
nested_hv_enabled      = false

# Network interface configuration
network_interfaces = [
    {
        adapter_type = "vmxnet3"
    }
]

# VM customization and tools settings
sync_time_with_host  = true
tools_upgrade_policy = "manual"

# Control plane configuration and Worker configuration
control_plane = {
  num_cpus  = 8
  memory_mb = 32768
}

worker = {
  num_cpus  = 4
  memory_mb = 16384
}

worker_disks = {
  label       = "disk0"
  size        = 100
  unit_number = 0
}

control_plane_disks = {
  label       = "disk0"
  size        = 1024
  unit_number = 0
}
