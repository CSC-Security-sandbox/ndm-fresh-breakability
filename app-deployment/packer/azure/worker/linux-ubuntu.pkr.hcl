packer {
  required_version = ">= 1.12.0"
  required_plugins {
    azure = {
      source  = "github.com/hashicorp/azure"
      version = ">= 2.3.0"
    }
    ansible = {
      source  = "github.com/hashicorp/ansible"
      version = ">= 1.1.2"
    }
  }
}

# Build Version
variable "build_version" {
  type        = string
  description = "The version of the build."
}

# General Variables
variable "project_name" {
  type    = string
  description = "The name of the project."
}

variable "image_suffix" {
  description = "Suffix to append to image names"
  type        = string
  default     = ""
}

# Azure Variables
variable "azure_client_id" {
  description = "Azure Client ID used for authentication"
  type        = string
  default     = env("ARM_CLIENT_ID")
}

variable "azure_client_secret" {
  description = "Azure Client Secret used for authentication"
  type        = string
  default     = env("ARM_CLIENT_SECRET")
}

variable "azure_tenant_id" {
  description = "Azure Tenant ID used for authentication"
  type        = string
  default     = env("ARM_TENANT_ID")
}

variable "azure_subscription_id" {
  description = "Azure Subscription ID where the resources will be created"
  type        = string
  default     = env("ARM_SUBSCRIPTION_ID")
}

variable "azure_resource_group" {
  type        = string
  description = "Azure Resource Group where the image will be created"
}

variable "azure_region" {
  type        = string
  description = "Azure region for the VM and managed image"
}

variable "azure_packer_vm_size" {
  type        = string
  description = "The size of the VM to be used in the Azure image creation"
}

variable "azure_ubuntu_release_version" {
  type        = string
  description = "The version of Ubuntu to be used in the Azure image creation"
}

# Missing Variables

variable "os_disk_size_gb" {
  type        = number
  description = "The size in GB for the OS disk of the VM image"
}

variable "image_publisher" {
  type        = string
  description = "The publisher of the image (e.g. Canonical)"
}

variable "image_offer" {
  type        = string
  description = "The offer of the image (e.g. UbuntuServer)"
}

variable "image_sku" {
  type        = string
  description = "The SKU of the image (e.g. 18.04-LTS)"
}

variable "virtual_network_name" {
  type        = string
  description = "The name of the virtual network"
}

variable "virtual_network_subnet_name" {
  type        = string
  description = "The name of the subnet in the virtual network"
}

variable "os_type" {
  type        = string
  description = "The operating system type (e.g. Linux or Windows)"
}

variable "ssh_username" {
  type        = string
  description = "The SSH username for accessing the VM"
}

variable "virtual_network_resource_group" {
  type        = string
  description = "The resource group containing the virtual network to build the VM (different from image resource group)"
}

variable "ssh_file_transfer_method" {
  type        = string
  description = "The file transfer method to be used for SSH (e.g., scp, sftp)"
  default     = "scp"
}

# Local binary path

variable "worker_binary_path" {
  type        = string
  description = "The path to the worker binary"
}

// Shared Image Gallery Destination Variables
variable "sig_destination_subscription" {
  type        = string
  description = "Shared Image Gallery destination subscription"
  default     = null
}

variable "sig_destination_resource_group" {
  type        = string
  description = "Shared Image Gallery destination resource group"
  default     = null
}

variable "sig_destination_gallery_name" {
  type        = string
  description = "Shared Image Gallery destination gallery name"
  default     = null
}

variable "sig_destination_image_definition_name" {
  type        = string
  description = "Shared Image Gallery destination image name"
  default     = null
}

variable "sig_storage_account_type" {
  type        = string
  description = "Storage account type for the Shared Image Gallery Image Version (Standard_LRS, Standard_ZRS, Premium_LRS)"
  default     = "Standard_LRS"
}

variable "sig_specialized" {
  type        = bool
  description = "Set to true if publishing to a Specialized Gallery"
  default     = false
}

variable "sig_use_shallow_replication" {
  type        = bool
  description = "Set to true for shallow replication mode"
  default     = false
}

locals {
  timestamp = regex_replace(timestamp(), "[- TZ:]", "")
}

locals {
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
  version             = formatdate("YYYY.DD.MMhhmmss", timestamp())
  image_name          = "${var.project_name}-worker-${local.formatted_timestamp}${var.image_suffix == "" ? "" : "-${var.image_suffix}"}"
}

# "###################################"
# "#    Azure source for packer      #"
# "###################################"
# az vm image list --location eastus --publisher Canonical --offer ubuntu-24_04-lts --sku server --all --output table

source "azure-arm" "azure_ubuntu" {
  client_id                           = var.azure_client_id
  client_secret                       = var.azure_client_secret
  tenant_id                           = var.azure_tenant_id
  subscription_id                     = var.azure_subscription_id

  os_disk_size_gb                     = var.os_disk_size_gb
  #disk_additional_size               = [ 150 ]
  managed_image_name                  = local.image_name
  managed_image_resource_group_name   = var.azure_resource_group
  image_publisher                     = var.image_publisher
  image_offer                         = var.image_offer
  image_sku                           = var.image_sku
  image_version                       = var.azure_ubuntu_release_version
  vm_size                             = var.azure_packer_vm_size
  location                            = var.azure_region
  virtual_network_name                = var.virtual_network_name
  virtual_network_subnet_name         = var.virtual_network_subnet_name
  virtual_network_resource_group_name = var.virtual_network_resource_group

  os_type                             = var.os_type
  ssh_username                        = var.ssh_username
  ssh_file_transfer_method            = var.ssh_file_transfer_method

  shared_image_gallery_destination {
    subscription                            = var.azure_subscription_id
    resource_group                          = var.azure_resource_group
    gallery_name                            = var.sig_destination_gallery_name
    image_name                              = var.sig_destination_image_definition_name
    image_version                           = local.version
    storage_account_type                    = var.sig_storage_account_type
    specialized                             = var.sig_specialized
    use_shallow_replication                 = var.sig_use_shallow_replication
    target_region {
      name = "East US"
    }
    target_region {
      name = "East US 2"
    }
  }

  azure_tags = {
    "stackname" = local.image_name
    "createdby" = "packer"
    "project"   = var.project_name
    "cloud"     = "azure"
  }
}

build {
  sources = [
    "source.azure-arm.azure_ubuntu"
  ]

  provisioner "ansible" {
    playbook_file          = "../../../ansible/worker/playbooks/master-playbook.yaml"
    inventory_directory    = "../../../ansible/worker/config"
    galaxy_file            = "../../../ansible/worker/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    user                   = "packer"
    ansible_env_vars = [
      "ANSIBLE_CONFIG=../../../ansible/worker/config/ansible.cfg"
    ]
    extra_arguments = [
      "--extra-vars", "display_skipped_hosts=false",
      "--extra-vars", "local_binary_path=${var.worker_binary_path}",
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
    "/usr/sbin/waagent -force -deprovision+user && export HISTSIZE=0 && sync"
  ]
  inline_shebang = "/bin/sh -x"
}
}