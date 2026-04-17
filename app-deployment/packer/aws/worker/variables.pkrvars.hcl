// Project Settings
project_name                 = "datamigrator"
component_name               = "worker"
ssh_file_transfer_method     = "scp"

// AWS Configuration
aws_region                   = "us-east-1"

// SSH Configuration
ssh_username                 = "ubuntu"

// VPC and Subnet Configuration
vpc_id                       = "vpc-0cce6fb6ec77a8daf" // OnPremisesConnectivity
subnet_id                    = "subnet-0c9a53ce5ee64c369" // OnPremises-us-east1anew

// AWS AMI and Instance Configuration
aws_ami_name                 = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20251212"
aws_root_device_type         = "ebs"
aws_virtualization_type      = "hvm"
aws_ami_owner                = "099720109477"
aws_packer_instance_type     = "t3a.2xlarge"

// AWS Block Device Configuration
aws_block_device_name                  = "/dev/sda1"
aws_block_device_volume_size           = 100
aws_block_device_volume_type           = "gp2"
aws_block_device_delete_on_termination = true