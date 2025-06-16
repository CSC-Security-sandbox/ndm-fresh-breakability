terraform {
  required_providers {
    vsphere = {
      source  = "hashicorp/vsphere"
      version = "~> 2.12.0"
    }
  }

  backend "s3" {
    bucket         = "ndm-preview-environments-terraform-state"
    region         = "us-east-1"
    encrypt        = true
  }
}

provider "vsphere" {
  user                 = var.vsphere_user
  password             = var.vsphere_password
  vsphere_server       = var.vsphere_server
  allow_unverified_ssl = true
}