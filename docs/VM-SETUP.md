# App Deployment

This guide provides step-by-step instructions to set up a MicroK8s cluster on a VM.

## Prerequisites

Ensure the following tools are installed on your macOS system:

- **Azure CLI**: [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos)
- **Ansible**: [Ansible](https://formulae.brew.sh/formula/ansible)

### Exporting Environment Variables

- Replace the placeholder values with actual values:
  ```sh
  export AZ_USERNAME=""
  export AZ_PASSWORD=""
  export AZ_TENANT=""
  export ARM_CLIENT_ID=""
  export ARM_CLIENT_SECRET=""
  ```

### Installing Datamigrator Control Plane on MicroK8s

- Run the setup script:

  ```sh
  cd vm-deployment/bin
  ./setup.sh control-plane
  ```

### Installing Datamigrator Data Plane

#### Before running the script download the binary from github

1. Download the binary from the [worker](https://github.com/NetApp-Cloud-DataMigrate/worker/tags) repository, extract the zip file and take the path of `worker-linux-x64` binary (Linux).
2. Note the path of the binary and copy it.
3. Run the script and when prompted, provide the full path to the binary on your local Mac:

   ```sh
   cd vm-deployment/bin
   ./setup.sh data-plane
   ```

4. Login to vault UI - `https://IP_ADDRESS/ui/` and give the root token for login. All application secrets are stored in vault. Navigate to secrets after opening the vault ui.
5. Keycloak UI - `https://IP_ADDRESS/keycloak/`
6. NDM UI - `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
7. Temporal UI - `https://IP_ADDRESS/temporal/ui/`
8. Postgres connection - Use the multipass IP to connect to postgres database. Get the username, password from vault. Keys are - `POSTGRES_DMADMIN_USER` and `POSTGRES_DMADMIN_PASSWORD`.

### Setting Up Worker (Initial Build)

1. Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
2. Create a project.
3. Click on "View instructions to set up worker".
4. SSH into the worker vm:

   ```sh
   ssh <WORKER_VM_IP>
   ```

5. Login as the root user:

   ```sh
   sudo su -
   ```

6. Paste the instructions copied in step 3.
7. Verify the status of the worker:
   ```sh
   systemctl status datamigrator-worker.service
   ```
8. Check the logs using the following command:
   ```sh
   tail -20f /opt/datamigrator/logs/datamigrator-worker.log
   ```
9. Navigate to DM UI to see if the worker is registered or not.
