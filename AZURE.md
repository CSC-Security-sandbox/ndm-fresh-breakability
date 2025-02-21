# Azure VM Deployment Guide

This guide will help you navigate the Azure UI to create a Virtual Machine (VM) using custom Packer-created images for both control plane and worker (data-plane) in your subscription. This guide is designed for non-technical users and provides detailed steps.

## Prerequisites

- Ensure the following tools are installed on your macOS system:

1. **Azure CLI**: [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos)

## Steps to Create a VM

### 1. Navigate to Azure UI
- Go to the [Azure Portal](https://portal.azure.com/).

### 2. Get Custom Images
- Ensure you have the custom Packer-created images available in your Azure subscription. These images should be listed under your Images section.

### 3. Create a VM
- In the Azure Portal, select the image you want to create VM from.
- Select "Create VM" from the panel.

### 4. Configure VM Settings
- **Subscription**: MigrationAsAService-dev
- **Resource Group**: datamigrate-acr-resource-group
- **Image**: Choose the custom Packer-created image for control plane or worker as required.
- **Size**: Select size based on the image you are deploying. For control plane, select a larger image.
- **License type**: Other
- **Administrator Account**:
    - **Username**: Enter `ubuntu`.
    - **SSH Public Key**: Paste your SSH public key or create a new one.
- **Disks**: leave the settings as it is.
- **Delete disk on VM delete**: Select this option
- **Virtual Network (VNet)**: datamigrate-dev-vnet
- **Public IP**: Set to "None" to avoid assigning a public IP.
- **Delete NIC when VM is deleted**: Select this option



### 5. Review and Create
- Review all the settings and click "Review + Create" to deploy the VM.

## Steps to Connect to Your VM

### Access Control Plane VM
### 1. Exporting Environment Variables

- Replace the placeholder values with actual values:
    ```sh
    export AZ_USERNAME=""
    export AZ_PASSWORD=""
    export AZ_TENANT=""
    ```

### 2. SSH into the VM
- Open your terminal.
- Login to azure
    ```sh
    az login --service-principal --username "${AZ_USERNAME}" --password "${AZ_PASSWORD}" --tenant "${AZ_TENANT}"
    ```
- Open Azure bastion tunnel. 
- Get the VM name from azure > select VM > JSON view > resource ID
    ```sh
    az network bastion tunnel --resource-group datamigrate-acr-resource-group --target-resource-id $vmname --resource-port 22 --port 3022 --name datamigrate-dev-vnet-bastion &
    ```
- Use the following command to SSH into your VM:
    ```sh
    ssh -i <SSH-KEY> ubuntu@localhost -p 3022
    ```

### 3. Log In
- Once connected, you will be logged into the VM as the `ubuntu` user.
- Switch the user to `datamigrator`.
    ```sh
    sudo su - datamigrator
    ```
### 4. Wait for Application to Boot Up
- After logging in, wait for the application to boot up. This may take a few minutes.
- Check the status of boot service and logs using the following comamands:
    ```sh
    sudo systemctl status boot-microk8s.service
    tail -10f /var/log/datamigrator/microk8s-boot.log
    ```

### 5. Verify Application Status
- Once the boot setup is complete, use `kubectl` commands to verify that all the pods are up and running:
    ```sh
    kubectl get pods -n datamigrator
    ```

### Steps for Worker (Data-Plane) VM

- Login to a windows VM for accessing the application. This is needed because netapp azure VM are not accessible from the outside, so we have a SMB server in the same network to access the application.
- Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `welcome`.
- Create a project.
- Click on "View instructions to set up worker".
- Login to azure
    ```sh
    az login --service-principal \
    --username  "${AZ_USERNAME}" \
    --password "${AZ_PASSWORD}" \
    --tenant "${AZ_TENANT}"
    ```
- Open Azure bastion tunnel. 
- Get the VM name from azure > select VM > JSON view > resource ID for data-plane server
    ```sh
    az network bastion tunnel --resource-group datamigrate-acr-resource-group --target-resource-id $vmname --resource-port 22 --port 4022 --name datamigrate-dev-vnet-bastion &
    ```
- Use the following command to SSH into your VM:
    ```sh
    ssh -i <SSH-KEY> ubuntu@localhost -p 4022
    ```
- Login as the root user:
    ```sh
    sudo su -
    ```
- Paste the instructions copied in step 3.
- Verify the status of the worker:
    ```sh
    systemctl status datamigrator-worker.service
    ```
- Check the logs using the following command:
    ```sh
    tail -20f /opt/datamigrator/logs/datamigrator-worker.log
    ```
- Navigate to DM UI to see if the worker is registered or not.

By following these steps, you should be able to successfully create, connect, and verify your Azure VMs using custom Packer-created images.

## Troubleshooting SSH Connection Issues

If you encounter issues connecting to your VM via SSH, follow these steps:

### 1. Restart the VM
- Go to the Azure Portal.
- Navigate to your VM and click on "Restart".

### 2. Reset SSH Configuration
- Follow the instructions in this [troubleshooting guide](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/troubleshoot-ssh-connection).

By following these steps, you should be able to successfully create and connect to your Azure VM.
