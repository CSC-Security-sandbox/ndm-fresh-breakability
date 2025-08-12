# Azure Resource Configuration
resource_group         = "MigrationAsAService-dev-infra"
gallery_resource_group = "datamigrate-acr-resource-group"
vnet_name              = "MigrationAsAService-dev-VNET01"
subnet_name            = "MigrationAsAService-dev-Subnet01"
gallery_name           = "datamigrator"
location               = "East US 2"

# Image Configuration
control_plane_image_definition = "ndm-control-plane"
worker_image_definition        = "ndm-worker"

# VM Configuration
control_plane_vm_size = "Standard_D8ads_v6"
worker_vm_size        = "Standard_D4ads_v6"

# Deployment Scale
linux_worker_count     = 2
windows_worker_count   = 2
deploy_windows_workers = true

# Windows Marketplace Image Configuration
windows_image_publisher = "MicrosoftWindowsServer"
windows_image_offer     = "WindowsServer"
windows_image_sku       = "2022-datacenter"
windows_image_version   = "latest"
