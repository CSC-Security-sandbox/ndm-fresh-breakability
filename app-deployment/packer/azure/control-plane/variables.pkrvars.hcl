// Packer Build Values
project_name                 = "datamigrator"
ssh_username                 = "packer"

// Azure Control Plane Values
azure_ubuntu_release_version = "24.04.202502210"
azure_resource_group         = "datamigrate-acr-resource-group"
azure_packer_vm_size         = "Standard_D8alds_v6"
azure_region                 = "East US"

// Azure Base Image Values
os_disk_size_gb              = 200
os_type                      = "Linux"
image_publisher              = "Canonical"
image_offer                  = "ubuntu-24_04-lts"
image_sku                    = "server"
virtual_network_name         = "datamigrate-dev-vnet"
virtual_network_subnet_name  = "default"

// SSH Bastion Host Values
ssh_bastion_host             = "20.51.200.139"
ssh_bastion_username         = "ubuntu"
ssh_bastion_password         = "Hacker@123321"
ssh_file_transfer_method     = "scp"

// Shared Image Gallery Destination Values
sig_destination_gallery_name              = "datamigrator"
sig_storage_account_type                  = "Standard_LRS"
sig_destination_image_definition_name     = "ndm-control-plane"
sig_specialized                           = false
sig_use_shallow_replication               = false