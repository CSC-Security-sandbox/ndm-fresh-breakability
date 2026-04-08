// Project Settings
project_name                 = "datamigrator"
component_name               = "control-plane"
ssh_username                 = "packer"
temporary_key_pair_type      = "ecdsa"

// GCP Project Values
gcp_project_id               = "app-microservices-cm"
gcp_region                   = "us-east1"
gcp_zone                     = "us-east1-b"
gcp_packer_machine_type      = "e2-standard-8"
gcp_source_image             = "ubuntu-2404-noble-amd64-v20250228"
gcp_disk_size                = 1024
gcp_network                  = "appmicro-vpc1"
gcp_subnetwork               = "appmicro-vpc-subnet-01"