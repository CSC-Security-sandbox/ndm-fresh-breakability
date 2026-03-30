packer {
  required_version = ">= 1.12.0"
  required_plugins {
    ansible = {
      version = ">= 1.1.2"
      source = "github.com/hashicorp/ansible"
    }
    amazon = {
      version = ">= 1.3.6"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

// Build Version
variable "build_version" {
  type        = string
  description = "The version of the build."
}

// Variables
variable "project_name" {
  type        = string
  description = "The name of the project."
}

variable "component_name" {
  type        = string
  description = "The name of the component."
}

variable "ssh_file_transfer_method" {
  type        = string
  description = "The file transfer method to be used for SSH (e.g., scp, sftp)"
}

// SSH Configuration
variable "ssh_username" {
  description = "SSH username for the instance"
  type        = string
}

variable "ssh_communicator" {
  description = "SSH communicator for Packer"
  type        = string
  default     = "ssh"
}

// AWS Credentials
variable "aws_secret_key" {
  description = "AWS secret key"
  type        = string
}

variable "aws_access_key" {
  description = "AWS access key"
  type        = string
}

// AWS AMI and Instance Configuration
variable "aws_ami_name" {
  description = "Name filter for the AWS AMI"
  type        = string
}

variable "aws_root_device_type" {
  description = "Root device type for the AWS AMI"
  type        = string
  default     = "ebs"
}

variable "aws_virtualization_type" {
  description = "Virtualization type for the AWS AMI"
  type        = string
  default     = "hvm"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "aws_packer_instance_type" {
  description = "Instance type for Packer"
  type        = string
}

variable "aws_block_device_name" {
  description = "AWS block device name"
  type        = string
  default     = "/dev/sda1"
}

variable "aws_block_device_volume_size" {
  description = "AWS block device volume size"
  type        = number
  default     = 200
}

variable "aws_block_device_volume_type" {
  description = "AWS block device volume type"
  type        = string
  default     = "gp2"
}

variable "aws_ami_owner" {
  description = "AWS AMI owner"
  type        = string
  default     = "099720109477"
}

variable "aws_block_device_delete_on_termination" {
  description = "Whether to delete the block device on termination"
  type        = bool
  default     = true
}

// VPC and Subnet Configuration
variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_id" {
  description = "Subnet ID"
  type        = string
}

// Local Variables
locals {
  timestamp           = regex_replace(timestamp(), "[- TZ:]", "")
  formatted_timestamp = formatdate("DD-MM-YYYY-hh-mm-ss", timestamp())
}

# "###################################"
# "#    AWS source for packer      #"
# "###################################"

source "amazon-ebs" "aws_ubuntu" {
  access_key    = var.aws_access_key
  secret_key    = var.aws_secret_key
  region        = var.aws_region
  ami_name      = "${var.project_name}-${var.component_name}-${local.formatted_timestamp}"
  instance_type = var.aws_packer_instance_type

  vpc_id                       = var.vpc_id
  subnet_id                    = var.subnet_id
  ssh_username                 = var.ssh_username

  launch_block_device_mappings {
    device_name           = var.aws_block_device_name
    volume_size           = var.aws_block_device_volume_size
    volume_type           = var.aws_block_device_volume_type
    delete_on_termination = var.aws_block_device_delete_on_termination
  }

  source_ami_filter {
    filters = {
      name                = var.aws_ami_name
      root-device-type    = var.aws_root_device_type
      virtualization-type = var.aws_virtualization_type
    }
    owners      = [var.aws_ami_owner]
    #most_recent = true
  }

  communicator                 = var.ssh_communicator
  ssh_file_transfer_method     = var.ssh_file_transfer_method

  tags = {
    "StackName" = "${var.project_name}-${var.component_name}-${local.formatted_timestamp}"
    "CreatedBy" = "Packer"
    "Project"   = var.project_name
    "Cloud"     = "AWS"
  }
}

// Build Configuration
build {
  sources = ["source.amazon-ebs.aws_ubuntu"]

  provisioner "ansible" {
    playbook_file          = "../../../ansible/control-plane/playbooks/master-playbook.yaml"
    inventory_directory    = "../../../ansible/control-plane/config"
    galaxy_file            = "../../../ansible/control-plane/playbooks/linux-requirements.yaml"
    galaxy_force_with_deps = true
    user                   = var.ssh_username

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
      "shred -u /root/.ssh/authorized_keys /home/${var.ssh_username}/.ssh/authorized_keys || true",
      "export HISTSIZE=0",
      "sync"
    ]
    inline_shebang = "/bin/sh -x"
  }
}
