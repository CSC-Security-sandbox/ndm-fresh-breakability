// Project Settings
project_name = "datamigrator"

// Packer Settings
destroy_vm_post_build = true

// vSphere Credentials
vsphere_insecure_connection = true

// vSphere Settings
vsphere_datacenter                     = "Datacenter"
vsphere_cluster                        = "NDMCluster"
vsphere_host                           = "10.192.7.18"
vsphere_datastore                      = "datastore"
vsphere_network                        = "VM Network"
vsphere_folder                         = "ova-build"
// vsphere_resource_pool                  = "MGMT-ResourcePool/TNT25-EVM01"
vsphere_set_host_for_datastore_uploads = false

// CPU Settings
vm_cpu_count    = 8
vm_cpu_cores    = 1
vm_cpu_hot_add  = false

// Memory Settings
vm_mem_size     = 32768
vm_mem_hot_add  = false

// Disk Settings
vm_disk_size    = 1048576

// Default Account Credentials

// Virtual Machine Settings
common_vm_version           = 14
common_tools_upgrade_policy = false
common_remove_cdrom         = true

// Template and Content Library Settings
common_template_conversion         = false
common_content_library             = "datamigrator-ovf-builds"
common_content_library_enabled     = false
common_content_library_ovf         = true
common_content_library_destroy     = true
common_content_library_skip_export = false

// OVF Export Settings
common_ovf_export_enabled   = true
common_ovf_export_overwrite = true

// Removable Media Settings
common_iso_datastore               = "datamigrator-iso"
common_iso_content_library         = "datamigrator-source-iso"
common_iso_content_library_enabled = true

iso_datastore_path       = "iso/linux/ubuntu-server/24-04-lts/amd64"
iso_content_library_item = "ubuntu-24.04.2-live-server-amd64"
iso_file                 = "ubuntu-24.04.2-live-server-amd64.iso"

// Boot and Provisioning Settings
common_data_source       = "disk"
common_http_ip           = null
common_http_port_min     = 8000
common_http_port_max     = 8099
common_ip_wait_timeout   = "20m"
common_ip_settle_timeout = "5s"
common_shutdown_timeout  = "15m"

// VM Storage Settings
vm_disk_device   = "sda"
vm_disk_use_swap = true
vm_disk_partitions = [
  {
    name = "efi"
    size = 1024,
    format = {
      label  = "EFIFS",
      fstype = "fat32",
    },
    mount = {
      path    = "/boot/efi",
      options = "",
    },
    volume_group = "",
  },
  {
    name = "boot"
    size = 1024,
    format = {
      label  = "BOOTFS",
      fstype = "xfs",
    },
    mount = {
      path    = "/boot",
      options = "",
    },
    volume_group = "",
  },
  {
    name = "sysvg"
    size = -1,
    format = {
      label  = "",
      fstype = "",
    },
    mount = {
      path    = "",
      options = "",
    },
    volume_group = "sysvg",
  },
]
vm_disk_lvm = [
  {
    name : "sysvg",
    partitions : [
      {
        name = "lv_swap",
        size = 1024,
        format = {
          label  = "SWAPFS",
          fstype = "swap",
        },
        mount = {
          path    = "",
          options = "",
        },
      },
      {
        name = "lv_root",
        size = -1,
        format = {
          label  = "ROOTFS",
          fstype = "xfs",
        },
        mount = {
          path    = "/",
          options = "",
        },
      },
    ],
  }
]

// Guest Operating System Metadata
vm_guest_os_name    = "ubuntu"
vm_guest_os_version = "24.04-lts"

// Virtual Machine Guest Operating System Setting
vm_guest_os_type = "ubuntu64Guest"

// Virtual Machine Hardware Settings
vm_firmware = "efi-secure"

// Cloud-Init Settings
vm_guest_os_cloudinit = true

// VM Network Settings (default DHCP)
# vm_ip_address = "192.168.3.40"
# vm_ip_netmask = 26
# vm_ip_gateway = "192.168.3.1"
# vm_dns_list   = [ "1.1.1.1", "1.0.0.1" ]
