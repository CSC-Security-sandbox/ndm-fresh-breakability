# Azure VM Creator for NDM

This Go script creates Azure Virtual Machines for NetApp Data Migration (NDM) control plane and worker nodes using Azure SDK for Go.

## Features

- ✅ Creates VMs based on custom compute gallery images
- ✅ Supports both control-plane and worker VM types
- ✅ Uses the exact VM specification from your template
- ✅ Configurable image versions
- ✅ Automatic network interface creation
- ✅ TrustedLaunch security profile
- ✅ Premium SSD storage

## Prerequisites

1. **Azure CLI**: Must be logged in (`az login`)
2. **Go**: Version 1.21 or higher
3. **Azure Permissions**: Compute and Network resource creation permissions
4. **Environment Variables** (optional):
   ```bash
   AZURE_SUBSCRIPTION_ID=1630c6a9-d99b-498a-aca8-a271f7506bc0
   AZURE_RESOURCE_GROUP=datamigrate-acr-resource-group
   AZURE_LOCATION=eastus
   ```

## Quick Start

1. **Navigate to the directory**:
   ```bash
   cd C:\Users\ubuntu\Desktop\NDM\ndm\app-deployment\terraform\azure
   ```

2. **Initialize Go modules**:
   ```bash
   go mod tidy
   ```

3. **Run the script**:
   ```bash
   go run create-vm.go
   ```

4. **Follow the prompts**:
   - Enter VM name prefix (e.g., `kb-test`)
   - Choose VM type:
     - `1` = Control Plane (Standard_D8s_v3)
     - `2` = Worker (Standard_D4s_v3)
   - Enter image version (e.g., `2025.19.08190213`)

## Example Usage

```bash
$ go run create-vm.go

🚀 Azure VM Creator for NDM Control Plane & Workers
====================================================
Enter VM name prefix (e.g., kb-test): kb-perf-test
Enter VM type (1=control-plane, 2=worker): 1
Enter image version (e.g., 2025.19.08190213): 2025.19.08190213

🔧 Creating control-plane VM: kb-perf-test-control-plane-001
📍 Location: eastus
🖥️  VM Size: Standard_D8s_v3
📦 Image Version: 2025.19.08190213
📡 Creating network interface...
🖥️  Creating virtual machine...
⏳ Waiting for VM creation to complete...
✅ Successfully created VM: kb-perf-test-control-plane-001
🎯 VM is ready for NDM control-plane deployment!
```

## VM Specifications

### Control Plane VM
- **VM Size**: Standard_D8s_v3 (8 vCPUs, 32 GB RAM)
- **Image**: `/subscriptions/.../galleries/datamigrator/images/ndm-control-plane/versions/{version}`
- **OS Disk**: 200 GB Premium SSD
- **Security**: TrustedLaunch with Secure Boot and vTPM

### Worker VM
- **VM Size**: Standard_D4s_v3 (4 vCPUs, 16 GB RAM)
- **Image**: `/subscriptions/.../galleries/datamigrator/images/ndm-worker/versions/{version}`
- **OS Disk**: 200 GB Premium SSD
- **Security**: TrustedLaunch with Secure Boot and vTPM

## Configuration

The script automatically configures:
- **Admin User**: ubuntu
- **Password**: Password@123 (configurable)
- **Network**: Uses existing `datamigrate-vnet/default` subnet
- **Zone**: Availability Zone 1
- **Boot Diagnostics**: Enabled

## Image Versions

Available image versions in the compute gallery:
- `2025.19.08190213` - Latest stable
- Contact your NDM team for other available versions

## Troubleshooting

1. **Authentication Issues**:
   ```bash
   az login --use-device-code
   ```

2. **Missing Resource Group**:
   - Ensure the resource group exists
   - Check subscription permissions

3. **Network Issues**:
   - Verify VNet `datamigrate-vnet` exists
   - Check subnet `default` is available

4. **Image Not Found**:
   - Verify image version exists in compute gallery
   - Check gallery permissions

## Integration with NDM

After VM creation, the VMs are ready for:
- NDM control plane deployment
- Worker node registration
- Performance testing setup

Use the created VMs with your existing NDM performance testing framework!
