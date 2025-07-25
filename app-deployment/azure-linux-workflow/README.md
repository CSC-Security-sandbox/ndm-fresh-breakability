# Azure VM Deployment with Terraform

This project automates the deployment of a control plane VM and multiple worker VMs on Azure using Terraform. The control plane and worker VMs can be configured to use specific image versions or the latest available images from a shared image gallery.

**Note**: VM names now include timestamps for unique identification (format: YYYYMMDD-hhmm).

## Prerequisites

- **Azure CLI**: Ensure you have the Azure CLI installed and authenticated
- **Terraform**: Install Terraform from [terraform.io](https://terraform.io)
- **jq**: Ensure jq is installed for JSON processing in the bash script

## Project Structure

```
├── README.md                 # This file
├── GITHUB_ACTIONS_SETUP.md   # GitHub Actions setup instructions
├── script.sh                 # Bash script to automate the deployment process
├── .github/
│   └── workflows/
│       └── deploy-azure-vms.yml  # GitHub Actions workflow
├── control_plane/            # Terraform configurations for the control plane VM
│   ├── main.tf
│   └── variables.tf
└── worker/                   # Terraform configurations for the worker VMs
    ├── main.tf
    ├── variables.tf
    ├── terraform.tfstate
    └── terraform.tfstate.backup
```
## Usage

### Option 1: Local Deployment (Script)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Run the deployment script:**
   ```bash
   ./script.sh
   ```

3. **Follow the prompts:**
   - Enter the control plane image version (leave blank for the latest)
   - Enter the worker image version (leave blank for the latest)
   - Enter the number of worker VMs (default is 1)

### Option 2: GitHub Actions Workflow (Automated)

1. **Set up Azure credentials** in GitHub repository secrets (see [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md))
2. **Go to Actions tab** in your GitHub repository
3. **Run the "Deploy Azure VMs with Terraform" workflow**
4. **Choose deployment parameters** and action (deploy/destroy)

> 📋 **Note**: For detailed GitHub Actions setup instructions, see [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)

## Example

```bash
$ ./script.sh
Enter control plane image version (leave blank for latest): 1.0.0
Enter worker image version (leave blank for latest): 1.0.0
Enter number of worker VMs (default 1): 3

Using:
  Control Plane Image Version: '1.0.0'
  Worker Image Version: '1.0.0'
  Number of Workers: 3

Deploying Control Plane...
...
Control Plane Private IP: 10.0.0.4

Deploying 3 Worker(s)...
...
Worker Private IPs:
10.0.0.5
10.0.0.6
10.0.0.7

Deployment complete!
```
## Terraform Configuration

### Control Plane

**Provider Configuration:**
```hcl
provider "azurerm" {
  features {}
  subscription_id = "1630c6a9-d99b-498a-aca8-a271f7506bc0"
}
```

**Data Sources:**
- `azurerm_shared_image_version`: Retrieves the specified image version
- `azurerm_shared_image`: Retrieves the latest image if no version is specified
- `azurerm_virtual_network`: Retrieves the virtual network
- `azurerm_subnet`: Retrieves the subnet

**Resources:**
- `azurerm_network_interface`: Creates a network interface for the VM
- `azurerm_linux_virtual_machine`: Creates the control plane VM

### Worker

**Provider Configuration:**
```hcl
provider "azurerm" {
  features {}
  subscription_id = "1630c6a9-d99b-498a-aca8-a271f7506bc0"
}
```

**Data Sources:**
- `azurerm_shared_image_version`: Retrieves the specified image version
- `azurerm_shared_image`: Retrieves the latest image if no version is specified
- `azurerm_virtual_network`: Retrieves the virtual network
- `azurerm_subnet`: Retrieves the subnet

**Resources:**
- `azurerm_network_interface`: Creates network interfaces for the worker VMs
- `azurerm_linux_virtual_machine`: Creates the worker VMs
## Outputs

### Control Plane
- `vm_private_ip`: The private IP address of the control plane VM

### Worker
- `worker_private_ips`: The private IP addresses of the worker VMs

## Notes

- Ensure the `subscription_id` in the provider block is correctly set to your Azure subscription
- Customize the variables in the Terraform configurations to match your environment
- The script automatically handles Terraform initialization and applies configurations with auto-approval

## Cleanup

To destroy the created resources, navigate to each directory (`control_plane` and `worker`) and run:

```bash
terraform destroy -auto-approve
```

Or you can create a cleanup script to automate this process.

## License

This project is licensed under the MIT License.