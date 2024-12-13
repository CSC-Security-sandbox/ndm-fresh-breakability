
packer {
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = "~> 1"
    }
  }
}

# General Variables
variable "project_name" {
  type    = string
}

variable "datamigrate_release_version" {
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
  ssh_username  = "ubuntu"
  tags = {
    "StackName" = "${var.project_name}-control-plane-ami-${local.formatted_timestamp}"
    "CreatedBy" = "Packer"
    "Project"   = var.project_name
    "Cloud"     = "AWS"
  }
}

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

build {
  sources = [
    "source.amazon-ebs.aws_ubuntu"
    # "source.azure-arm.azure_ubuntu",
    # "source.googlecompute.gcp_ubuntu"
  ]

  provisioner "ansible" {
    playbook_file       = "../../ansible/playbooks/master-playbook.yaml"
    inventory_directory = "../../ansible/config"
    user                = "ubuntu"
    extra_arguments     = ["-v", "-e", "datamigrate_release_version=${var.datamigrate_release_version}"]
  }

  # Add checksum post-processor to verify the image
  # post-processor "checksum" {
  #   checksum_types      = ["sha256"]
  #   output              = "${local.output_dir}/${local.vm_name}.{{.ChecksumType}}"
  #   keep_input_artifact = true
  # }
}
