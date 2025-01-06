packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
    azure = {
      source  = "github.com/hashicorp/azure"
      version = "~> 2"
    }
    ansible = {
      version = "~> 1"
      source = "github.com/hashicorp/ansible"
    }
    virtualbox = {
      version = "~> 1"
      source  = "github.com/hashicorp/virtualbox"
    }
  }
}

# General Variables
variable "project_name" {
  type    = string
}

locals {
  timestamp = regex_replace(timestamp(), "[- TZ:]", "")
}
locals {
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
}

# AWS Variables
variable "aws_access_key" {
  type    = string
  default = env("AWS_ACCESS_KEY_ID")
}

variable "aws_secret_key" {
  type    = string
  default = env("AWS_SECRET_ACCESS_KEY")
}

variable "aws_region" {
  type    = string
}

variable "aws_ubuntu_release_version" {
  type    = string
}

variable "aws_packer_instance_type" {
  type    = string 
}

# Azure Variables

variable "azure_client_id" {
  description = "Azure Client ID"
  type        = string
  default     = env("ARM_CLIENT_ID")
}

variable "azure_client_secret" {
  description = "Azure Client Secret"
  type        = string
  default     = env("ARM_CLIENT_SECRET")
}

variable "azure_tenant_id" {
  description = "Azure Tenant ID"
  type        = string
  default     = env("ARM_TENANT_ID")
}

variable "azure_subscription_id" {
  description = "Azure Subscription ID"
  type        = string
  default     = env("ARM_SUBSCRIPTION_ID")
}

variable "azure_resource_group" {
  type    = string
  description = "Azure Resource Group where the image will be created"
}

variable "azure_region" {
  type    = string
  description = "Azure region for the VM and managed image"
}

variable "azure_packer_vm_size" {
  type    = string
  description = "The size of the VM to be used in the Azure image creation"
}

variable "azure_ubuntu_release_version" {
  type    = string
  description = "The version of Ubuntu to be used in the Azure image creation"
}

# variable "ssh_public_key" {
#   type    = string
#   description = "SSH public key to access the VM"
# }

# Azure source for packer
# source "azure-arm" "azure_ubuntu" {
#   client_id       = var.azure_client_id
#   client_secret   = var.azure_client_secret
#   tenant_id       = var.azure_tenant_id
#   subscription_id = var.azure_subscription_id

#   os_disk_size_gb = 100
#   disk_additional_size = [ 150 ]
#   managed_image_name = "${var.project_name}-control-plane-${local.formatted_timestamp}"
#   managed_image_resource_group_name = var.azure_resource_group
#   #public_ip_sku                     = "standard"
#   image_publisher = "Canonical"
#   image_offer     = "ubuntu-24_04-lts"
#   image_sku       = "server"
#   image_version   = var.azure_ubuntu_release_version
#   vm_size         = var.azure_packer_vm_size
#   location        = var.azure_region
#   virtual_network_name = "datamigrate-dev-vnet"
#   virtual_network_subnet_name = "default"
#   virtual_network_resource_group_name = var.azure_resource_group

#   os_type          = "Linux"
#   ssh_username     = "ubuntu"
#   #ssh_public_key   = var.ssh_public_key

#   ssh_bastion_host     = "20.51.200.139"
#   ssh_bastion_username = "ubuntu"
#   ssh_bastion_password = "Hacker@123321"
#   ssh_file_transfer_method = "scp"


#   azure_tags = {
#     "StackName" = "${var.project_name}-control-plane-ami-${local.formatted_timestamp}"
#     "CreatedBy" = "Packer"
#     "Project"   = var.project_name
#     "Cloud"     = "Azure"
#   }
# }

# build {
#   sources = [
#     "source.azure-arm.azure_ubuntu"
#   ]
#   provisioner "shell" {
#     execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
#     inline = [
#           "lsblk"
#     ]
#     inline_shebang = "/bin/sh -x"
#   }
#   provisioner "ansible" {
#     playbook_file       = "../../ansible/playbooks/master-playbook.yaml"
#     inventory_directory = "../../ansible/config"
#     user                = "ubuntu"
#     extra_arguments     = ["-v", "-e", "datamigrate_release_version=${var.datamigrate_release_version}"]
#   }
#   provisioner "shell" {
#     execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
#     inline = [
#           "/usr/sbin/waagent -force -deprovision+user && export HISTSIZE=0 && sync"
#     ]
#     inline_shebang = "/bin/sh -x"
#   }
#   provisioner "shell" {
#     execute_command = "chmod +x {{ .Path }}; {{ .Vars }} sudo -E sh '{{ .Path }}'"
#     inline = [
#       "cat /etc/passwd",                          # Check the users on the system
#       "whoami",                                   # Check the current user (should be root or another valid user)
#       "ls -la /home",                             # List home directories to see if the user directory still exists
#       "lsblk",                                    # List block devices (check if there are any unmounted disks or volumes)
#       "id datamigrate",                           # Check if the user is still in the system (replace ${user_name} with the actual user)
#       "grep datamigrate /etc/sudoers",            # Check if the user still has sudo permissions (if applicable)
#       "ls /var/log/waagent.log",                  # Check the waagent log for any deprovisioning-related messages
#       "sudo -u root ls /root",                    # List the contents of the root home directory
#       "dmesg | tail -n 20",                       # Check recent system messages (useful for detecting errors)
#       "df -h",                                    # Check disk usage to ensure system is clean
#       "free -m"                                   # Check available memory
#     ]
#     inline_shebang = "/bin/bash -x"
#   }

# }

# source "azure-arm" "azure_ubuntu" {
#   managed_image_name      = "${var.project_name}-ubuntu-${var.ubuntu_version}-{{timestamp}}"
#   location                = var.azure_region
#   resource_group_name     = var.resource_group
#   storage_account         = var.storage_account
#   os_type                 = "Linux"
#   image_publisher         = "Canonical"
#   image_offer             = "UbuntuServer"
#   image_sku               = "24_04-lts"
#   ssh_username            = "packer"
# }

# source "googlecompute" "gcp_ubuntu" {
#   project_id       = var.gcp_project_id
#   source_image     = "projects/ubuntu-os-cloud/global/images/ubuntu-2404-lts"
#   zone             = "us-central1-a"
#   machine_type     = "e2-micro"
#   image_name       = "${var.project_name}-ubuntu-${var.ubuntu_version}-{{timestamp}}"
# }

source "amazon-ebs" "aws_ubuntu" {
  access_key    = var.aws_access_key
  secret_key    = var.aws_secret_key
  ami_name      = "${var.project_name}-control-plane-${local.formatted_timestamp}"
  instance_type = var.aws_packer_instance_type
  region        = var.aws_region
  ssh_port      = "22"
  launch_block_device_mappings {
    device_name = "/dev/sda1"
    volume_size = 50
    volume_type = "gp2"
    delete_on_termination = true
  }
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-${var.aws_ubuntu_release_version}"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners      = ["099720109477"]
    #most_recent = true
  }
  communicator = "ssh"
  ssh_username  = "ubuntu"
  tags = {
    "StackName" = "${var.project_name}-control-plane-ami-${local.formatted_timestamp}"
    "CreatedBy" = "Packer"
    "Project"   = var.project_name
    "Cloud"     = "AWS"
  }
}

build {
  sources = [
    "source.amazon-ebs.aws_ubuntu"
  ]

  provisioner "ansible" {
    playbook_file       = "../../control-plane/ansible/playbooks/master-playbook.yaml"
    inventory_directory = "../../control-plane/ansible/config"
    user                = "ubuntu"
    extra_arguments     = ["-v"]
  }
}
