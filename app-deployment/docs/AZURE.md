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

- Locate the Shared Image Gallery:
  - In the Azure Portal, search for "Azure Compute Galleries" in the search bar at the top.
  - Select **Compute Galleries** from the search results.
  - Click on the gallery named **datamigrator**.
- Select the Image Definition:
  - Inside the **datamigrator** gallery, you will see two image definitions:
    - `ndm-control-plane` (for Control Plane VMs)
    - `ndm-worker` (for Worker VMs)
  - Click on the image definition you want to use (e.g., `ndm-control-plane`).
- Choose the Latest Image Version:
  - Inside the image definition, you will see a list of image versions in the format `YYYY.DD.MMhhmmss`.
  - Identify the latest version (it will be marked as **Latest**).
  - Click on the latest version to proceed.
- Select **Create VM** from the panel.

### 3. Create a Control Plane VM

- Select the control plane latest image following the above steps.
- Configure VM Settings:
  - **Subscription**: MigrationAsAService-dev
  - **Resource Group**: datamigrate-acr-resource-group
  - **VM name**: Use your name as prefix for any VM you create. Prefer creating VM with name `<your-name>-<image-name>`.
  - **Image**: Choose the custom Packer-created image for control plane.
  - **Size**: Recommended size is 8 vCPU, 32GB RAM.
  - **Administrator Account**:
    - **Username**: Enter `ubuntu`.
    - **SSH Public Key**: Paste your SSH public key or create a new one.
  - **License type**: Other
  - Click on **Next: Disks >**:
    - **Delete with VM**: Optional, can be selected if you want to delete the OS disk along with the VM.
  - Click on **Next: Networking >**:
    - **Virtual Network (VNet)**: datamigrate-dev-vnet
    - **Public IP**: Set to "None" to avoid assigning a public IP.
    - **Delete NIC when VM is deleted**: Optional, can be selected if you want to delete the NIC along with the VM.
  - If you created a new SSH key, at the end it will prompt you to download. Please keep the key safe as it cannot be downloaded again.
  - Leave other options as they are.

### 4. Create a Data Plane VM

- Follow the same steps as above in the "Get Custom Images" section.
- Configure VM Settings:
  - **Subscription**: MigrationAsAService-dev
  - **Resource Group**: datamigrate-acr-resource-group
  - **VM name**: Use your name as prefix for any VM you create. Prefer creating VM with name `<your-name>-<image-name>`.
  - **Image**: Choose the custom Packer-created image for worker.
  - **Size**: Recommended size is 4 vCPU, 8GB RAM.
  - **Administrator Account**:
    - **Username**: Enter `ubuntu`.
    - **SSH Public Key**: Paste your SSH public key or create a new one.
  - **License type**: Other
  - Click on **Next: Disks >**:
    - **Delete with VM**: Optional, can be selected if you want to delete the OS disk along with the VM.
  - Click on **Next: Networking >**:
    - **Virtual Network (VNet)**: datamigrate-dev-vnet
    - **Public IP**: Set to "None" to avoid assigning a public IP.
    - **Delete NIC when VM is deleted**: Optional, can be selected if you want to delete the NIC along with the VM.
  - If you created a new SSH key, at the end it will prompt you to download. Please keep the key safe as it cannot be downloaded again.
  - Leave other options as they are.

### 5. Review and Create

- Review all the settings and click **Review + Create** to deploy the VM.
- Click on **Create**.
- If creating a new key pair, you will be prompted to **Generate new key pair**:
  - Click on **Download private key and create resource**.
  - Once clicked, a `.pem` file will be downloaded.

## Steps to Connect to Your VM

### Access Control Plane VM (When setting up control plane for the first time)

1. Select the control plane VM from Azure portal.
2. Click on **Connect** in the left pane and select **Bastion**.
3. Select the following:
   - **Authentication type**: SSH Private Key from Local File
   - **User**: `ubuntu`
   - **SSH key**: Select the SSH key you selected when creating the VM.
   - **Open in new browser tab**: YES
4. Click on **Connect**.

#### Troubleshooting Bastion Connection

- If you encounter issues opening the SSH Bastion portal:
  1. Visit the Azure Control Plane VM.
  2. Click on **Help → Reset password**.
  3. Select **Add SSH Public Key** from Mode.
  4. Add username as `ubuntu`.
  5. Set **SSH public key source** to **Use existing key stored in Azure**.
  6. Select your existing created key under **Stored Key**.
  7. Click on **Update**.
  8. Retry connecting via Bastion.

### Log In

- Once connected, you will be logged into the VM as the `ubuntu` user.
- Switch the user to `datamigrator`:
  ```sh
  sudo su - datamigrator
  ```

### Check Service Status

- Check the status of boot service and logs using the following commands. The service will be in a disabled state at this point:
  ```sh
  sudo systemctl status boot-microk8s.service
  ```

### Start the Boot Service & Boot Up the Application

- Start the application boot up. This may take a few minutes:
  ```sh
  sudo systemctl start boot-microk8s.service &
  ```

### View Boot Service Logs (Optional)

- To check boot service logs:
  ```sh
  tail -10f /opt/datamigrator/logs/ndm-first-boot.log
  ```

### Verify Application Status

- Once the boot setup is complete, use `kubectl` commands to verify that all the pods are up and running:
  ```sh
  kubectl get pods -n datamigrator
  ```

### Steps for Connecting Worker VM (When setting up data plane for the first time)

1. Login to a Windows VM for accessing the application. This is needed because NetApp Azure VMs are not accessible from the outside.
   Search for any of the Virtual machine listed below on Azure UI and then Login to the Windows VMs via Bastion:
   - `ndm-alpha-windows-1` - `10.0.0.124`
   - `ndm-alpha-windows-2` - `10.0.0.125`
   - `ndm-alpha-windows-3` - `10.0.0.126`
2. Bastion connection details:
   - **Authentication type**: VM Password
   - For username and password, reach out to Anurag Doshi/Praful Patil/Ashish Sinha

### Steps for Worker VM (When setting up data plane for the first time)

- Login to a windows VM for accessing the application. This is needed because netapp azure VM are not accessible from the outside.
- Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`. This `IP_ADDRESS` is the control plane IP address.
  The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
- Create a project.
- Click on "View instructions to set up worker".
- Connect to the worker VM SSH

1. Select the worker VM from Azure portal.
2. Click on **Connect** in the left pane and select **Bastion**.
3. Select the following:
   - **Authentication type**: SSH Private Key from Local File
   - **User**: `ubuntu`
   - **SSH key**: Select the SSH key you selected when creating the VM.
   - **Open in new browser tab**: YES
4. Click on **Connect**.

- Login as the root user:
  ```sh
  sudo su -
  ```
- Paste the instructions copied from the control plane ui.
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

1. Fetch the openbao root token. SSH into the control plane server from bastion connect from the Azure portal:

   ```sh
   sudo su - datamigrator
   cat /opt/datamigrator/openbao/cluster-keys.json
   ```

2. Login to openbao UI - `https://IP_ADDRESS/ui/` and give the root token for login. All application secrets are stored in openbao. Navigate to secrets after opening the openbao ui.
3. Keycloak UI - `https://IP_ADDRESS/keycloak/`
4. NDM UI - `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
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

- To get the pods in `datamigrator` namespace:
  ```sh
  kubectl get pods -n datamigrator
  ```
- To get the logs for a pod in `datamigrator` namespace:
  ```sh
  kubectl logs <podname> -n datamigrator
  ```
- To describe a pod in `datamigrator` namespace:
  ```sh
  kubectl describe pod <podname> -n datamigrator
  ```
- To get all namespaces:
  ```sh
  kubectl get ns
  ```
- To get the pods in any namespace:
  ```sh
  kubectl get pods -n <NAMESPACE>
  ```
- To delete a pod in `datamigrator` namespace:
  ```sh
  kubectl delete pod <podname> -n datamigrator
  ```
- To get the events in `datamigrator` namespace:
  ```sh
  kubectl get events -n datamigrator
  ```
- To execute a command inside a running pod:
  ```sh
  kubectl exec -it <podname> -n datamigrator -- <command>
  ```
- To check the cluster nodes:
  ```sh
  kubectl get nodes
  ```
- To get the resource usage of pods in `datamigrator` namespace:
  ```sh
  kubectl top pods -n datamigrator
  ```
- To get the resource usage of nodes:
  ```sh
  kubectl top nodes
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
