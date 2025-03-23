# Azure VM Deployment Guide

This guide will help you navigate the Azure UI to create a Virtual Machine (VM) using custom Packer-created images for both control plane and worker (data-plane) in your subscription. This guide is designed for non-technical users and provides detailed steps.

<span style="color:red"><strong>NOTE:</strong> Delete/stop the VMs you create once you are done with testing to avoid unnecessary costs.</span>

## Prerequisites

- Ensure the following tools are installed on your macOS system:

1. **Azure CLI**: [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos)

## Steps to Create a VM (Same steps for control plane and data plane)

### 1. Navigate to Azure UI
- Go to the [Azure Portal](https://portal.azure.com/).
- Login to Azure HCL account.
- **Subscription name**: MigrationAsAService-dev

### 2. Get Custom Images
- Ensure you have the custom Packer-created images available in your Azure subscription. These images should be listed under your Images section.
- Take images of worker and control plane in images service of azure.
- The image name format is `datamigrator-worker-DATE-TIMESTAMP` & `datamigrator-control-plane-DATE-TIMESTAMP`

### 3. Create a VM
- In the Azure Portal, select the image you want to create VM from.
- Select "Create VM" from the panel.

### 4. Configure VM Settings
- **Subscription**: MigrationAsAService-dev
- **Resource Group**: datamigrate-acr-resource-group
- **VM name**: Use your name as prefix for any VM you create.
- **Image**: Choose the custom Packer-created image for control plane or worker as required.
- **Size**: Select size based on the image you are deploying. For control plane, select a larger image.
- **Administrator Account**:
    - **Username**: Enter `ubuntu`.
    - **SSH Public Key**: Paste your SSH public key or create a new one. 
- **License type**: Other
- **Disks**: Select delete OS disk with VM.
- **Virtual Network (VNet)**: datamigrate-dev-vnet
- **Public IP**: Set to "None" to avoid assigning a public IP.
- **Delete NIC when VM is deleted**: Select this option
- If you created a new SSH key, at the end it will prompt you to download. Please keep the key safe as it cannot be downloaded again.
- Leave other options as it is.

NOTE: Use the same settings for data plane and control plane VMs.

### 5. Review and Create
- Review all the settings and click "Review + Create" to deploy the VM.

## Using Scripts to Create SSH Tunnels

You can use the provided shell and PowerShell scripts to create SSH tunnels for both control plane and data plane VMs. These scripts will prompt you for the necessary inputs and set up the tunnels.

### Shell Script

- When you run the scripts, you will be promted for some user inputs. The azure credentials will be provided separately.
- **Resource Group**: datamigrate-acr-resource-group
- In the VM name, give the name of azure VMs you created.
- Use your local laptops terminal to open the tunnel.

- Save the following script as `create_tunnel.sh` and run it on a Unix-based system (like macOS or Linux):

    ```sh
    #!/bin/bash

    # Prompt for user input
    read -p "Enter Azure Username: " AZ_USERNAME
    read -sp "Enter Azure Password: " AZ_PASSWORD
    echo
    read -p "Enter Azure Tenant ID: " AZ_TENANT
    read -p "Enter Resource Group: " RESOURCE_GROUP
    read -p "Enter Control Plane VM Name: " CONTROL_PLANE_VM
    read -p "Enter Data Plane VM Name: " DATA_PLANE_VM
    read -p "Enter SSH Key Path: " SSH_KEY_PATH

    # Login to Azure
    az login --service-principal --username "${AZ_USERNAME}" --password "${AZ_PASSWORD}" --tenant "${AZ_TENANT}"

    # Get Control Plane VM Resource ID
    CONTROL_PLANE_VM_ID=$(az vm show --resource-group $RESOURCE_GROUP --name $CONTROL_PLANE_VM --query id -o tsv)

    # Open SSH tunnel for Control Plane VM
    az network bastion tunnel --resource-group $RESOURCE_GROUP --target-resource-id $CONTROL_PLANE_VM_ID --resource-port 22 --port 3022 --name datamigrate-dev-vnet-bastion &

    # Get Data Plane VM Resource ID
    DATA_PLANE_VM_ID=$(az vm show --resource-group $RESOURCE_GROUP --name $DATA_PLANE_VM --query id -o tsv)

    # Open SSH tunnel for Data Plane VM
    az network bastion tunnel --resource-group $RESOURCE_GROUP --target-resource-id $DATA_PLANE_VM_ID --resource-port 22 --port 4022 --name datamigrate-dev-vnet-bastion &

    echo "SSH tunnels created. Use the following commands to connect:"
    echo "Control Plane VM: ssh -i $SSH_KEY_PATH ubuntu@localhost -p 3022"
    echo "Data Plane VM: ssh -i $SSH_KEY_PATH ubuntu@localhost -p 4022"

    # Wait for all background jobs to finish
    wait
    ```
- To run the script, use the following command in your terminal:
    ```sh
    chmod +x create_tunnel.sh
    ./create_tunnel.sh
    ```

### Powershell Script

- Use your local laptops terminal to open the tunnel.
- For windows, Save the following script as `create_tunnel.ps1` and run it:

    ```sh
    # Prompt for user input
    $AZ_USERNAME = Read-Host "Enter Azure Username"
    $AZ_PASSWORD = Read-Host "Enter Azure Password" -AsSecureString
    $AZ_TENANT = Read-Host "Enter Azure Tenant ID"
    $RESOURCE_GROUP = Read-Host "Enter Resource Group"
    $CONTROL_PLANE_VM = Read-Host "Enter Control Plane VM Name"
    $DATA_PLANE_VM = Read-Host "Enter Data Plane VM Name"
    $SSH_KEY_PATH = Read-Host "Enter SSH Key Path"

    # Convert secure string to plain text
    $AZ_PASSWORD_PLAIN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($AZ_PASSWORD))

    # Login to Azure
    az login --service-principal --username $AZ_USERNAME --password $AZ_PASSWORD_PLAIN --tenant $AZ_TENANT

    # Get Control Plane VM Resource ID
    $CONTROL_PLANE_VM_ID = az vm show --resource-group $RESOURCE_GROUP --name $CONTROL_PLANE_VM --query id -o tsv

    # Open SSH tunnel for Control Plane VM
    Start-Process -NoNewWindow -FilePath "az" -ArgumentList "network bastion tunnel --resource-group $RESOURCE_GROUP --target-resource-id $CONTROL_PLANE_VM_ID --resource-port 22 --port 3022 --name datamigrate-dev-vnet-bastion"

    # Get Data Plane VM Resource ID
    $DATA_PLANE_VM_ID = az vm show --resource-group $RESOURCE_GROUP --name $DATA_PLANE_VM --query id -o tsv

    # Open SSH tunnel for Data Plane VM
    Start-Process -NoNewWindow -FilePath "az" -ArgumentList "network bastion tunnel --resource-group $RESOURCE_GROUP --target-resource-id $DATA_PLANE_VM_ID --resource-port 22 --port 4022 --name datamigrate-dev-vnet-bastion"

    Write-Output "SSH tunnels created. Use the following commands to connect:"
    Write-Output "Control Plane VM: ssh -i $SSH_KEY_PATH ubuntu@localhost -p 3022"
    Write-Output "Data Plane VM: ssh -i $SSH_KEY_PATH ubuntu@localhost -p 4022"

    # Wait for all jobs to finish
    Get-Job | Wait-Job
    ```
- To run the script, use the following command in your PowerShell:
    ```sh
    .\create_tunnel.ps1
    ```

## Steps to Connect to Your VM

### Access Control Plane VM (When setting up control plane for the first time)

### 1. SSH into the VM

- Use your local laptops terminal.
- Make sure SSH tunnel is opened by running the scripts mentioned above.
- Use the following command to SSH into your VM:
    ```sh
    ssh -i <SSH-KEY> ubuntu@localhost -p 3022
    ```

### 2. Log In
- Once connected, you will be logged into the VM as the `ubuntu` user.
- Switch the user to `datamigrator`.
    ```sh
    sudo su - datamigrator
    ```
### 3.  Check service status
- Check the status of boot service and logs using the following comamands. The service will be in disabled state at this point.
    ```sh
    sudo systemctl status boot-microk8s.service
    ```
### 4.  Start the boot service & boot Up the application
- After logging in, start the application boot up. This may take a few minutes.
- Start the boot service and check logs using the following comamands.
    ```sh
    sudo systemctl start boot-microk8s.service &
    tail -10f /var/log/datamigrator/microk8s-boot.log
    ```

### 5. Verify Application Status
- Once the boot setup is complete, use `kubectl` commands to verify that all the pods are up and running:
    ```sh
    kubectl get pods -n datamigrator
    ```

### Steps for Worker VM (When setting up data plane for the first time)

- Login to a windows VM for accessing the application. This is needed because netapp azure VM are not accessible from the outside, so we have a SMB server in the same network to access the application.
- Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `welcome`.
- Create a project.
- Click on "View instructions to set up worker".
- Use your local laptops terminal.
- Make sure SSH tunnel is opened by running the scripts mentioned above.
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

## Application Access

NOTE: All credentials are managed from openbao. Replace the `IP_ADDRESS` with your Control plane VM IP.

1. Fetch the openbao root token. Use your local laptops terminal. Make sure SSH tunnel is opened by running the scripts mentioned above. SSH into the control plane server after opening SSH tunnel.
    ```sh
    ssh -i <SSH-KEY> ubuntu@localhost -p 3022
    sudo su - datamigrator
    cat /opt/datamigrator/openbao/cluster-keys.json
    ```

2. Login to openbao UI - `https://IP_ADDRESS/ui/` and give the root token for login. All application secrets are stored in openbao. Navigate to secrets after opening the openbao ui.
3. Keycloak UI - `https://IP_ADDRESS/keycloak/`
4. NDM UI - `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `welcome`.
5. Temporal UI - `https://IP_ADDRESS/temporal/ui/`
6. Postgres connection - Use the multipass IP to connect to postgres database. Get the username, password from openbao. Keys are - `POSTGRES_DMADMIN_USER` and `POSTGRES_DMADMIN_PASSWORD`.


## Troubleshooting and reference

If you encounter issues connecting to your VM via SSH, follow these steps:

### 1. Restart the VM
- Go to the Azure Portal.
- Navigate to your VM and click on "Restart".

### 2. Reset SSH Configuration
- Follow the instructions in this [troubleshooting guide](https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-machines/linux/troubleshoot-ssh-connection).

By following these steps, you should be able to successfully create and connect to your Azure VM.

### 3. kubectl commands reference

- To get the pods in `datamigrator` namespace
  ```sh
  kubectl get pods -n datamigrator
  ```
- To get the logs for a pod in `datamigrator` namespace
  ```sh
  kubectl logs <podname> -n datamigrator
  ```
- To describe a pod in `datamigrator` namespace
  ```sh
  kubectl describe <podname> -n datamigrator
  ```
- To get all namespaces
  ```sh
  kubectl get ns
  ```
- To get the pods in any namespace
  ```sh
  kubectl get pods -n <NAMESPACE>
  ```

### 4. Unseal openbao

- If you encounter an issue where openbao is sealed, follow these steps to unseal openbao.
- SSH into the control plane server after opening SSH tunnel.
- Replace OPENBAO_UNSEAL_KEY with your key
  ```sh
  sudo su - datamigrator
  jq -r ".unseal_keys_b64[]" /opt/datamigrator/openbao/cluster-keys.json
  kubectl exec openbao-0 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  kubectl exec openbao-1 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  kubectl exec openbao-2 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  ```