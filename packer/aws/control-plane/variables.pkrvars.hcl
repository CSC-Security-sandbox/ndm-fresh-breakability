// Project Settings
project_name                 = "datamigrator"
component_name               = "control-plane"

// AWS Configuration
aws_region                   = "us-east-1"

// SSH Configuration
ssh_username                 = "ubuntu"

// VPC and Subnet Configuration
vpc_id                       = "vpc-0cce6fb6ec77a8daf" // OnPremisesConnectivity
subnet_id                    = "subnet-0ba24aac108bca5ca" // OnPremises-us-east1a

// AWS AMI and Instance Configuration
aws_ami_name                 = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20241109"
aws_root_device_type         = "ebs"
aws_virtualization_type      = "hvm"
aws_ami_owner                = "099720109477"
aws_packer_instance_type     = "t3a.2xlarge"

// AWS Block Device Configuration
aws_block_device_name                  = "/dev/sda1"
aws_block_device_volume_size           = 200
aws_block_device_volume_type           = "gp2"
aws_block_device_delete_on_termination = true

// Openlab Bastion Host Values
bastion_host_ip              = "10.195.82.18"
bastion_host_username        = "root"
bastion_host_private_key     = "~/.ssh/id_rsa"
bastion_host_port            = 22
ssh_file_transfer_method     = "scp"