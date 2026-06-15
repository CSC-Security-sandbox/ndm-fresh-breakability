# GCP Project Configuration
project_id = "app-microservices-cm"
region     = "us-east4"

# Network Configuration
network    = "appmicro-vpc1"
subnetwork = "appmicro-vpc-subnet-02"

# VM Sizing
control_plane_machine_type = "e2-custom-8-32768"
worker_machine_type        = "e2-custom-4-16384"

# Deployment Scale
linux_worker_count  = 2
windows_worker_count = 2
deploy_windows_workers = true

# Windows Image (Server 2022 Datacenter from GCP marketplace)
windows_image               = "projects/windows-cloud/global/images/family/windows-2022"
windows_worker_machine_type = "e2-custom-16-65536"

# gVNIC for higher throughput on worker data path
enable_gvnic = true
