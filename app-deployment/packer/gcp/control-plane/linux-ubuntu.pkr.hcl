packer {
  required_version = ">= 1.12.0"
  required_plugins {
    ansible = {
      version = ">= 1.1.2"
      source = "github.com/hashicorp/ansible"
    }
    googlecompute = {
      version = ">= 1.1.8"
      source  = "github.com/hashicorp/googlecompute"
    }
  }
}

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
}

// GCP Variables
variable "gcp_project_id" {
  type    = string
  description = "Value of GCP project id"
}

variable "gcp_region" {
  type = string
  description = "GCP Region"  
}

variable "gcp_zone" {
  type = string
  description = "GCP Zone"
}

variable "gcp_packer_machine_type" {
  type = string
  description = "Packer machine type"  
}

variable "gcp_source_image" {
  type = string
  description = "Source image for GCP"
}

variable "gcp_disk_size" {
  type = number
  description = "Disk size for GCP instance"
}

variable "gcp_network" {
  type = string
  description = "Network for GCP instance"
}

variable "gcp_subnetwork" {
  type = string
  description = "Subnetwork for GCP instance"
}

variable "ssh_username" {
  type = string
  description = "SSH username for GCP instance"
}

variable "temporary_key_pair_type" {
  type = string
  description = "Temporary key pair type"
}

locals {
  timestamp = regex_replace(timestamp(), "[- TZ:]", "")
}

locals {
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
  image_name          = "${var.project_name}-control-plane-${local.formatted_timestamp}${var.image_suffix == "" ? "" : "-${var.image_suffix}"}"
}

# "###################################"
# "#    GCP source for packer      #"
# "###################################"

source "googlecompute" "gcp_ubuntu" {
  project_id            = var.gcp_project_id
  source_image          = var.gcp_source_image
  disk_size             = var.gcp_disk_size
  zone                  = var.gcp_zone
  machine_type          = var.gcp_packer_machine_type
  network               = var.gcp_network
  subnetwork            = var.gcp_subnetwork
  image_name            = local.image_name
  region                = var.gcp_region
  ssh_username          = var.ssh_username
  omit_external_ip      = true
  use_internal_ip       = true

  metadata = {
    block-project-ssh-keys = "true"
  }

  image_labels = {
    "stackname" = local.image_name
    "createdby" = "packer"
    "project"   = var.project_name
    "cloud"     = "gcp"
  }

  temporary_key_pair_type      = var.temporary_key_pair_type
}

build {
  sources = [
    "source.googlecompute.gcp_ubuntu"
  ]

  provisioner "ansible" {
    playbook_file          = "../../../ansible/control-plane/playbooks/master-playbook.yaml"
    inventory_directory    = "../../../ansible/control-plane/config"
    galaxy_file            = "../../../ansible/control-plane/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    user                   = var.ssh_username
    ansible_ssh_extra_args =  [ "-oHostKeyAlgorithms=+ecdsa-sha2-nistp384", "-v" ]
    ansible_env_vars = [
      "ANSIBLE_CONFIG=../../../ansible/control-plane/config/ansible.cfg"
    ]
    extra_arguments = [
      "--extra-vars", "display_skipped_hosts=false",
      "--extra-vars", "@../../../ansible/control-plane/config/group_vars/vars.yaml",
      "--extra-vars", "build_version=${var.build_version}"
    ]
  }

  provisioner "shell" {
    execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
    inline = [
      "echo 'Cleaning package cache and temporary files...'",
      "apt-get autoremove --purge -y",
      "apt-get clean",
      "rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/* /var/tmp/*",
      "journalctl --flush --rotate && journalctl --vacuum-size=0 || true",
      "echo 'Zeroing free space for smaller exported image...'",
      "dd if=/dev/zero of=/var/tmp/zeros bs=1M 2>/dev/null || true",
      "rm -f /var/tmp/zeros",
      "sync"
    ]
    inline_shebang = "/bin/sh -x"
  }

  provisioner "shell" {
    execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
    inline = [
      "sudo google_osconfig_agent",
      "sudo google_metadata_script_runner",
      "sudo shred -u /root/.ssh/authorized_keys /home/packer/.ssh/authorized_keys || true",
      "sudo echo 'Authorized keys are shredded'",
      "sudo sync"
    ]
    inline_shebang = "/bin/sh -x"
  }
}