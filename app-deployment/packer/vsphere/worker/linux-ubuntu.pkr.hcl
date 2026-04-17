//  BLOCK: packer
//  The Packer configuration.

packer {
  required_version = ">= 1.12.0"
  required_plugins {
    vsphere = {
      source  = "github.com/hashicorp/vsphere"
      version = ">= 1.4.2"
    }
    ansible = {
      source  = "github.com/hashicorp/ansible"
      version = ">= 1.1.2"
    }
    git = {
      source  = "github.com/ethanmdavidson/git"
      version = ">= 0.6.3"
    }
  }
}

//  BLOCK: variable
//  Defines the input variables.

// Build Version
variable "build_version" {
  type        = string
  description = "The version of the build."
}

// Project Settings
variable "project_name" {
  type    = string
  description = "The name of the project."
}

variable "image_suffix" {
  description = "Suffix to append to image names"
  type        = string
  default     = ""
}

variable "component_name" {
  type        = string
  description = "The name of the project."
  default     = "worker"
}

variable "worker_binary_path" {
  type    = string
  description = "The path to the worker binary."
}

// vSphere Credentials

variable "vsphere_endpoint" {
  type        = string
  description = "The fully qualified domain name or IP address of the vCenter Server instance."
}

variable "vsphere_username" {
  type        = string
  description = "The username to login to the vCenter Server instance."
  sensitive   = true
}

variable "vsphere_password" {
  type        = string
  description = "The password for the login to the vCenter Server instance."
  sensitive   = true
}

variable "vsphere_insecure_connection" {
  type        = bool
  description = "Do not validate vCenter Server TLS certificate."
}

// vSphere Settings

variable "vsphere_datacenter" {
  type        = string
  description = "The name of the target vSphere datacenter."
  default     = ""
}

variable "vsphere_cluster" {
  type        = string
  description = "The name of the target vSphere cluster."
  default     = ""
}

variable "vsphere_host" {
  type        = string
  description = "The name of the target ESXi host."
  default     = ""
}

variable "vsphere_datastore" {
  type        = string
  description = "The name of the target vSphere datastore."
}

variable "vsphere_network" {
  type        = string
  description = "The name of the target vSphere network segment."
}

variable "vsphere_folder" {
  type        = string
  description = "The name of the target vSphere folder."
  default     = ""
}

variable "vsphere_resource_pool" {
  type        = string
  description = "The name of the target vSphere resource pool."
  default     = ""
}

variable "vsphere_set_host_for_datastore_uploads" {
  type        = bool
  description = "Set this to true if packer should use the host for uploading files to the datastore."
  default     = false
}

// Virtual Machine Settings

variable "vm_guest_os_language" {
  type        = string
  description = "The guest operating system lanugage."
  default     = "en_US"
}

variable "vm_guest_os_keyboard" {
  type        = string
  description = "The guest operating system keyboard input."
  default     = "us"
}

variable "vm_guest_os_timezone" {
  type        = string
  description = "The guest operating system timezone."
  default     = "UTC"
}

variable "vm_guest_os_family" {
  type        = string
  description = "The guest operating system family. Used for naming."
  default     = "linux"
}

variable "vm_guest_os_name" {
  type        = string
  description = "The guest operating system name. Used for naming."
}

variable "vm_guest_os_version" {
  type        = string
  description = "The guest operating system version. Used for naming."
}

variable "vm_guest_os_type" {
  type        = string
  description = "The guest operating system type, also know as guestid."
}

variable "vm_guest_os_cloudinit" {
  type        = bool
  description = "Enable cloud-init for the guest operating system."
  default     = true
}

variable "vm_firmware" {
  type        = string
  description = "The virtual machine firmware."
  default     = "efi-secure"
}

variable "vm_cdrom_type" {
  type        = string
  description = "The virtual machine CD-ROM type."
  default     = "sata"
}

variable "vm_cdrom_count" {
  type        = string
  description = "The number of virtual CD-ROMs remaining after the build."
  default     = 1
}

variable "vm_cpu_count" {
  type        = number
  description = "The number of virtual CPUs."
  default     = 2
}

variable "vm_cpu_cores" {
  type        = number
  description = "The number of virtual CPUs cores per socket."
  default     = 1
}

variable "vm_cpu_hot_add" {
  type        = bool
  description = "Enable hot add CPU."
  default     = false
}

variable "vm_mem_size" {
  type        = number
  description = "The size for the virtual memory in MB."
  default     = 2048
}

variable "vm_mem_hot_add" {
  type        = bool
  description = "Enable hot add memory."
  default     = false
}

variable "vm_disk_size" {
  type        = number
  description = "The size for the virtual disk in MB."
  default     = 40960
}

variable "vm_disk_controller_type" {
  type        = list(string)
  description = "The virtual disk controller types in sequence."
  default     = ["pvscsi"]
}

variable "vm_disk_thin_provisioned" {
  type        = bool
  description = "Thin provision the virtual disk."
  default     = true
}

variable "vm_network_card" {
  type        = string
  description = "The virtual network card type."
  default     = "vmxnet3"
}

variable "common_vm_version" {
  type        = number
  description = "The vSphere virtual hardware version."
}

variable "common_tools_upgrade_policy" {
  type        = bool
  description = "Upgrade VMware Tools on reboot."
  default     = true
}

variable "common_remove_cdrom" {
  type        = bool
  description = "Remove the virtual CD-ROM(s)."
  default     = true
}

// VM Network Settings

variable "vm_network_device" {
  type        = string
  description = "The network device of the VM."
  default     = "ens192"
}

variable "vm_ip_address" {
  type        = string
  description = "The IP address of the VM (e.g. 172.16.100.192)."
  default     = null
}

variable "vm_ip_netmask" {
  type        = number
  description = "The netmask of the VM (e.g. 24)."
  default     = null
}

variable "vm_ip_gateway" {
  type        = string
  description = "The gateway of the VM (e.g. 172.16.100.1)."
  default     = null
}

variable "vm_dns_list" {
  type        = list(string)
  description = "The nameservers of the VM."
  default     = []
}

// VM Storage Settings

variable "vm_disk_device" {
  type        = string
  description = "The device for the virtual disk. (e.g. 'sda')"
}

variable "vm_disk_use_swap" {
  type        = bool
  description = "Whether to use a swap partition."
}

variable "vm_disk_partitions" {
  type = list(object({
    name = string
    size = number
    format = object({
      label  = string
      fstype = string
    })
    mount = object({
      path    = string
      options = string
    })
    volume_group = string
  }))
  description = "The disk partitions for the virtual disk."
}

variable "vm_disk_lvm" {
  type = list(object({
    name = string
    partitions = list(object({
      name = string
      size = number
      format = object({
        label  = string
        fstype = string
      })
      mount = object({
        path    = string
        options = string
      })
    }))
  }))
  description = "The LVM configuration for the virtual disk."
  default     = []
}

// Template and Content Library Settings

variable "common_template_conversion" {
  type        = bool
  description = "Convert the virtual machine to template. Must be 'false' for content library."
  default     = false
}

variable "common_content_library_enabled" {
  type        = bool
  description = "Import the virtual machine into the vSphere content library."
  default     = true
}

variable "common_content_library" {
  type        = string
  description = "The name of the target vSphere content library, if enabled."
  default     = null
}

variable "common_content_library_ovf" {
  type        = bool
  description = "Export to content library as an OVF template."
  default     = true
}

variable "common_content_library_destroy" {
  type        = bool
  description = "Delete the virtual machine after exporting to the content library."
  default     = true
}

variable "common_content_library_skip_export" {
  type        = bool
  description = "Skip exporting the virtual machine to the content library. Option allows for testing/debugging without saving the machine image."
  default     = false
}

// OVF Export Settings

variable "common_ovf_export_enabled" {
  type        = bool
  description = "Enable OVF artifact export."
  default     = false
}

variable "common_ovf_export_overwrite" {
  type        = bool
  description = "Overwrite existing OVF artifact."
  default     = true
}

// Removable Media Settings

variable "common_iso_content_library_enabled" {
  type        = bool
  description = "Import the guest operating system ISO into the vSphere content library."
  default     = false
}

variable "common_iso_content_library" {
  type        = string
  description = "The name of the target vSphere content library for the guest operating system ISO."
}

variable "common_iso_datastore" {
  type        = string
  description = "The name of the target vSphere datastore for the guest operating system ISO."
}

variable "iso_datastore_path" {
  type        = string
  description = "The path on the source vSphere datastore for the guest operating system ISO."
}

variable "iso_file" {
  type        = string
  description = "The file name of the guest operating system ISO."
}

variable "iso_content_library_item" {
  type        = string
  description = "The vSphere content library item name for the guest operating system ISO."
}

// Boot Settings

variable "common_data_source" {
  type        = string
  description = "The provisioning data source. One of `http` or `disk`."
}

variable "common_http_ip" {
  type        = string
  description = "Define an IP address on the host to use for the HTTP server."
  default     = null
}

variable "common_http_port_min" {
  type        = number
  description = "The start of the HTTP port range."
}

variable "common_http_port_max" {
  type        = number
  description = "The end of the HTTP port range."
}

variable "vm_boot_order" {
  type        = string
  description = "The boot order for virtual machines devices."
  default     = "disk,cdrom"
}

variable "vm_boot_wait" {
  type        = string
  description = "The time to wait before boot."
  default     = "5s"
}

variable "common_ip_wait_timeout" {
  type        = string
  description = "Time to wait for guest operating system IP address response."
}

variable "common_ip_settle_timeout" {
  type        = string
  description = "Time to wait for guest operating system IP to settle down."
  default     = "5s"
}

variable "common_shutdown_timeout" {
  type        = string
  description = "Time to wait for guest operating system shutdown."
}

// Communicator Settings and Credentials

variable "build_username" {
  type        = string
  description = "The username to login to the guest operating system."
  #sensitive   = true
}

variable "build_password" {
  type        = string
  description = "The password to login to the guest operating system."
  sensitive   = true
}

variable "build_password_encrypted" {
  type        = string
  description = "The encrypted password to login the guest operating system."
  sensitive   = true
}

variable "build_key" {
  type        = string
  description = "The public key to login to the guest operating system."
  sensitive   = true
}

variable "bastion_proxy_host" {
  type        = string
  description = "The proxy server to use for SSH connection. (Optional)"
  default     = null
}

variable "bastion_proxy_username" {
  type        = string
  description = "The username to authenticate with the proxy server. (Optional)"
  default     = null
}

variable "bastion_proxy_password" {
  type        = string
  description = "The password to authenticate with the proxy server. (Optional)"
  sensitive   = true
  default     = null
}

variable "communicator_port" {
  type        = number
  description = "The port for the communicator protocol."
  default     = 22
}

variable "communicator_timeout" {
  type        = string
  description = "The timeout for the communicator protocol."
  default     = "30m"
}

// Additional Settings

variable "additional_packages" {
  type        = list(string)
  description = "Additional packages to install."
  default     = []
}

variable "linux_firmware_url" {
  type        = string
  description = "Direct download URL for the linux-firmware .deb package (Artifactory cache) to avoid Ubuntu mirror rate limits."
  default     = "https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/apt-cache/linux-firmware_20240318.git3b128b60-0ubuntu2.26_amd64.deb"
}

variable "artifactory_username" {
  type        = string
  description = "Artifactory username for authenticated downloads inside the VM during autoinstall."
  sensitive   = true
  default     = ""
}

variable "artifactory_password" {
  type        = string
  description = "Artifactory password for authenticated downloads inside the VM during autoinstall."
  sensitive   = true
  default     = ""
}

variable "destroy_vm_post_build" {
  type        = bool
  description = "Destroy the virtual machine after the build."
  default     = true
}

//  BLOCK: data
//  Defines the data sources.

data "git-repository" "cwd" {}
data "git-commit" "cwd-head" {}

//  BLOCK: locals
//  Defines the local variables.

locals {
  product_name       = "NetApp DataMigrator Worker"
  build_date        = formatdate("YYYY-MM-DD hh:mm ZZZ", timestamp())
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
  build_version     = substr(data.git-commit.cwd-head.hash, 0, 8)
  build_description = "Product: ${local.product_name}\nVendor: NetApp Inc.\nVersion: ${var.build_version}\nBuilt on: ${local.build_date}"
  iso_paths = {
    content_library = "${var.common_iso_content_library}/${var.iso_content_library_item}/${var.iso_file}",
    datastore       = "[${var.common_iso_datastore}] ${var.iso_datastore_path}/${var.iso_file}"
  }
  manifest_date   = formatdate("YYYY-MM-DD hh:mm:ss", timestamp())
  manifest_path   = "${path.cwd}/manifests/"
  manifest_output = "${local.manifest_path}${local.manifest_date}.json"
  ovf_export_path = "${path.cwd}/artifacts/${local.vm_name}"
  data_source_content = {
    "/meta-data" = file("${abspath(path.root)}/data/meta-data")
    "/user-data" = templatefile("${abspath(path.root)}/data/user-data.pkrtpl.hcl", {
      build_username           = var.build_username
      build_password           = var.build_password
      build_password_encrypted = var.build_password_encrypted
      vm_guest_os_language     = var.vm_guest_os_language
      vm_guest_os_keyboard     = var.vm_guest_os_keyboard
      vm_guest_os_timezone     = var.vm_guest_os_timezone
      network = templatefile("${abspath(path.root)}/data/network.pkrtpl.hcl", {
        device  = var.vm_network_device
        ip      = var.vm_ip_address
        netmask = var.vm_ip_netmask
        gateway = var.vm_ip_gateway
        dns     = var.vm_dns_list
      })
      storage = templatefile("${abspath(path.root)}/data/storage.pkrtpl.hcl", {
        device     = var.vm_disk_device
        swap       = var.vm_disk_use_swap
        partitions = var.vm_disk_partitions
        lvm        = var.vm_disk_lvm
      })
      additional_packages  = var.additional_packages
      linux_firmware_url   = var.linux_firmware_url
      artifactory_username = var.artifactory_username
      artifactory_password = var.artifactory_password
    })
  }
  data_source_command = var.common_data_source == "http" ? "ds=\"nocloud-net;seedfrom=http://{{.HTTPIP}}:{{.HTTPPort}}/\"" : "ds=\"nocloud\""
  vm_name             = "${var.project_name}-${var.component_name}-${local.formatted_timestamp}${var.image_suffix == "" ? "" : "-${var.image_suffix}"}"
}

//  BLOCK: source
//  Defines the builder configuration blocks.

source "vsphere-iso" "linux-ubuntu" {

  // vCenter Server Endpoint Settings and Credentials
  vcenter_server      = var.vsphere_endpoint
  username            = var.vsphere_username
  password            = var.vsphere_password
  insecure_connection = var.vsphere_insecure_connection

  // vSphere Settings
  datacenter                     = var.vsphere_datacenter
  cluster                        = var.vsphere_cluster
  host                           = var.vsphere_host
  datastore                      = var.vsphere_datastore
  folder                         = var.vsphere_folder
  resource_pool                  = var.vsphere_resource_pool
  set_host_for_datastore_uploads = var.vsphere_set_host_for_datastore_uploads

  // Virtual Machine Settings
  vm_name              = local.vm_name
  guest_os_type        = var.vm_guest_os_type
  firmware             = var.vm_firmware
  CPUs                 = var.vm_cpu_count
  cpu_cores            = var.vm_cpu_cores
  CPU_hot_plug         = var.vm_cpu_hot_add
  RAM                  = var.vm_mem_size
  RAM_hot_plug         = var.vm_mem_hot_add
  cdrom_type           = var.vm_cdrom_type
  disk_controller_type = var.vm_disk_controller_type
  storage {
    disk_size             = var.vm_disk_size
    disk_thin_provisioned = var.vm_disk_thin_provisioned
  }
  network_adapters {
    network      = var.vsphere_network
    network_card = var.vm_network_card
  }
  vm_version           = var.common_vm_version
  remove_cdrom         = var.common_remove_cdrom
  reattach_cdroms      = var.vm_cdrom_count
  tools_upgrade_policy = var.common_tools_upgrade_policy
  notes                = local.build_description
  destroy              = var.destroy_vm_post_build

  // Removable Media Settings
  iso_paths    = var.common_iso_content_library_enabled ? [local.iso_paths.content_library] : [local.iso_paths.datastore]
  http_content = var.common_data_source == "http" ? local.data_source_content : null
  cd_content   = var.common_data_source == "disk" ? local.data_source_content : null
  cd_label     = var.common_data_source == "disk" ? "cidata" : null

  // Boot and Provisioning Settings
  http_ip       = var.common_data_source == "http" ? var.common_http_ip : null
  http_port_min = var.common_data_source == "http" ? var.common_http_port_min : null
  http_port_max = var.common_data_source == "http" ? var.common_http_port_max : null
  boot_order    = var.vm_boot_order
  boot_wait     = var.vm_boot_wait
  boot_command = [
    "<wait5s>c<wait5s>",
    "linux /casper/vmlinuz --- autoinstall ${local.data_source_command}",
    "<enter><wait>",
    "initrd /casper/initrd",
    "<enter><wait>",
    "boot",
    "<enter>"
  ]
  ip_wait_timeout   = var.common_ip_wait_timeout
  ip_settle_timeout = var.common_ip_settle_timeout
  shutdown_command  = "echo '${var.build_password}' | sudo -S -E shutdown -P now"
  shutdown_timeout  = var.common_shutdown_timeout

  // Communicator Settings and Credentials
  communicator         = "ssh"
  ssh_username         = var.build_username
  ssh_password         = var.build_password
  ssh_port             = var.communicator_port
  ssh_timeout          = var.communicator_timeout

  // Template and Content Library Settings
  convert_to_template = var.common_template_conversion
  dynamic "content_library_destination" {
    for_each = var.common_content_library_enabled ? [1] : []
    content {
      library     = var.common_content_library
      description = local.build_description
      ovf         = var.common_content_library_ovf
      destroy     = var.common_content_library_destroy
      skip_import = var.common_content_library_skip_export
    }
  }

  // OVF Export Settings
  dynamic "export" {
    for_each = var.common_ovf_export_enabled ? [1] : []
    content {
      name  = local.vm_name
      force = var.common_ovf_export_overwrite
      options = [
        "extraconfig"
      ]
      output_directory = local.ovf_export_path
      output_format    = "ova"
    }
  }
}

//  BLOCK: build
//  Defines the builders to run, provisioners, and post-processors.

build {
  sources = ["source.vsphere-iso.linux-ubuntu"]

  provisioner "ansible" {
    user                   = var.build_username
    galaxy_file            = "../../../ansible/worker/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    playbook_file          = "../../../ansible/worker/playbooks/linux-playbook.yaml"
    roles_path             = "../../../ansible/worker/roles"
    ansible_env_vars = [
      "ANSIBLE_CONFIG=../../../ansible/worker/config/ansible.cfg"
    ]
    extra_arguments = [
      "--extra-vars", "display_skipped_hosts=false",
      "--extra-vars", "ansible_username=${var.build_username}",
      "--extra-vars", "ansible_key='${var.build_key}'",
      "--extra-vars", "enable_cloudinit=${var.vm_guest_os_cloudinit}",
      "--extra-vars", "build_version=${var.build_version}",
      "--extra-vars", "vsphere_build=true"
    ]
  }
  provisioner "ansible" {
    playbook_file          = "../../../ansible/worker/playbooks/master-playbook.yaml"
    inventory_directory    = "../../../ansible/worker/config"
    galaxy_file            = "../../../ansible/worker/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    user                   = var.build_username
    ansible_env_vars = [
      "ANSIBLE_CONFIG=../../../ansible/worker/config/ansible.cfg"
    ]
    extra_arguments = [
      "--extra-vars", "display_skipped_hosts=false",
      "--extra-vars", "ansible_username=${var.build_username}",
      "--extra-vars", "ansible_key='${var.build_key}'",
      "--extra-vars", "local_binary_path=${var.worker_binary_path}",
      "--extra-vars", "build_version=${var.build_version}",
      "--extra-vars", "vsphere_build=true"
    ]
  }

  provisioner "ansible" {
    user                   = var.build_username
    galaxy_file            = "../../../ansible/worker/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    playbook_file          = "../../../ansible/worker/playbooks/linux-cleanup.yaml"
    roles_path             = "../../../ansible/worker/roles"
    ansible_env_vars = [
      "ANSIBLE_CONFIG=../../../ansible/worker/config/ansible.cfg"
    ]
    extra_arguments = [
      "--extra-vars", "display_skipped_hosts=false",
      "--extra-vars", "ansible_username=${var.build_username}",
      "--extra-vars", "ansible_key='${var.build_key}'",
      "--extra-vars", "enable_cloudinit=${var.vm_guest_os_cloudinit}",
      "--extra-vars", "build_version=${var.build_version}",
      "--extra-vars", "vsphere_build=true"
    ]
  }

  provisioner "shell" {
    execute_command = "echo '${var.build_password}' | sudo -S -E sh '{{ .Path }}'"
    inline = [
      "echo 'Zeroing free space for smaller exported image...'",
      "dd if=/dev/zero of=/var/tmp/zeros bs=1M 2>/dev/null || true",
      "rm -f /var/tmp/zeros",
      "sync"
    ]
    inline_shebang = "/bin/sh -x"
  }

  post-processors {
  
    post-processor "manifest" {
      output     = local.manifest_output
      strip_path = true
      strip_time = true
      custom_data = {
        build_username           = var.build_username
        build_date               = local.build_date
        build_version            = local.build_version
        common_data_source       = var.common_data_source
        common_vm_version        = var.common_vm_version
        vm_cpu_cores             = var.vm_cpu_cores
        vm_cpu_count             = var.vm_cpu_count
        vm_disk_size             = var.vm_disk_size
        vm_disk_thin_provisioned = var.vm_disk_thin_provisioned
        vm_firmware              = var.vm_firmware
        vm_guest_os_type         = var.vm_guest_os_type
        vm_mem_size              = var.vm_mem_size
        vm_network_card          = var.vm_network_card
        vsphere_cluster          = var.vsphere_cluster
        vsphere_host             = var.vsphere_host
        vsphere_datacenter       = var.vsphere_datacenter
        vsphere_datastore        = var.vsphere_datastore
        vsphere_endpoint         = var.vsphere_endpoint
        vsphere_folder           = var.vsphere_folder
      }
    }

    post-processor "shell-local" {
      inline = [
        "../ovf-customizer/scripts/add_ovf_properties.sh \\",
        "  \"${local.ovf_export_path}\" \\",
        "  \"${local.product_name}\" \\",
        "  \"${var.build_version}\" \\",
        "  \"${var.vsphere_endpoint}\" \\",
        "  \"${var.vsphere_username}\" \\",
        "  \"${var.vsphere_password}\" \\",
        "  \"${var.vsphere_insecure_connection}\" \\",
        "  \"${var.common_content_library}\" \\"
      ]
    }
  }
}
