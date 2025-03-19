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

//  BLOCK: data
//  Defines the data sources.

data "git-repository" "cwd" {}
data "git-commit" "cwd-head" {}

//  BLOCK: locals
//  Defines the local variables.

locals {
  build_by          = "Built by: HashiCorp Packer ${packer.version}"
  build_date        = formatdate("YYYY-MM-DD hh:mm ZZZ", timestamp())
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
  build_version     = substr(data.git-commit.cwd-head.hash, 0, 8)
  build_description = "Version: ${local.build_version}\nBuilt on: ${local.build_date}\n${local.build_by}"
  iso_paths = {
    content_library = "${var.common_iso_content_library}/${var.iso_content_library_item}/${var.iso_file}",
    datastore       = "[${var.common_iso_datastore}] ${var.iso_datastore_path}/${var.iso_file}"
  }
  manifest_date   = formatdate("YYYY-MM-DD hh:mm:ss", timestamp())
  manifest_path   = "${path.cwd}/manifests/"
  manifest_output = "${local.manifest_path}${local.manifest_date}.json"
  // ovf_export_path = "${path.cwd}/artifacts/${local.vm_name}"
  ovf_export_path = "/ova/${local.vm_name}"
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
      additional_packages = var.additional_packages
    })
  }
  data_source_command = var.common_data_source == "http" ? "ds=\"nocloud-net;seedfrom=http://{{.HTTPIP}}:{{.HTTPPort}}/\"" : "ds=\"nocloud\""
  vm_name             = "${var.project_name}-${var.component_name}-${var.vm_guest_os_name}-${var.vm_guest_os_version}-${local.build_version}-${local.formatted_timestamp}"
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
      "--extra-vars", "enable_cloudinit=${var.vm_guest_os_cloudinit}"
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
      "--extra-vars", "local_binary_path=${var.worker_binary_path}"
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
    ]
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
  }
}