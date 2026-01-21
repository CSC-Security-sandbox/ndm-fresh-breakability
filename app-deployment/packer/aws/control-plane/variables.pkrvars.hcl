// Project Settings
project_name                 = "datamigrator"
component_name               = "control-plane"
ssh_file_transfer_method     = "scp"

// AWS Configuration
aws_region                   = "us-east-1"

// SSH Configuration
ssh_username                 = "ubuntu"

// VPC and Subnet Configuration
vpc_id                       = "vpc-065b68f0083bb1656" // OnPremisesConnectivity
subnet_id                    = "subnet-05c45fc0b10753005" // OnPremises-us-east1a

// AWS AMI and Instance Configuration
aws_ami_name                 = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20250921"
aws_root_device_type         = "ebs"
aws_virtualization_type      = "hvm"
aws_ami_owner                = "099720109477"
aws_packer_instance_type     = "t3a.2xlarge"

// AWS Block Device Configuration
aws_block_device_name                  = "/dev/sda1"
aws_block_device_volume_size           = 200
aws_block_device_volume_type           = "gp2"
aws_block_device_delete_on_termination = true