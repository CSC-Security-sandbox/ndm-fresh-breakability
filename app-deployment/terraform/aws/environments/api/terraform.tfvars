# AWS Region and Network Configuration
aws_region        = "us-east-1"
subnet_id         = "subnet-0c9a53ce5ee64c369"
security_group_id = "sg-019054b93bf4e8941"

# Instance Types (matched to Azure sizing)
# control_plane: Standard_D8s_v4  = 8 vCPU, 32 GB  → m5.2xlarge
# linux_worker:  Standard_D4s_v4  = 4 vCPU, 16 GB  → m5.xlarge
# windows_worker: Standard_D16s_v4 = 16 vCPU, 64 GB → m5.4xlarge
control_plane_instance_type  = "m5.2xlarge"
linux_worker_instance_type   = "m5.xlarge"
windows_worker_instance_type = "m5.4xlarge"

# Deployment Scale
linux_worker_count     = 2
windows_worker_count   = 2
deploy_windows_workers = true

# Volume Sizes
control_plane_root_volume_size  = 200
linux_worker_root_volume_size   = 100
windows_worker_root_volume_size = 100

# SSH username (baked into the NDM Linux/CP AMIs by Packer)
admin_username = "ubuntu"
