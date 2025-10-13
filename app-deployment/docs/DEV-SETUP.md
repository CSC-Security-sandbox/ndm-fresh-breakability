# App Deployment

This guide provides step-by-step instructions to set up a MicroK8s cluster locally on macOS.

## Prerequisites

Ensure the following tools are installed on your macOS system:

- **Docker Desktop**: [Install Docker Desktop](https://docs.docker.com/desktop/install/mac-install/)
- **Azure CLI**: [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos)
- **Multipass**: [Multipass](https://formulae.brew.sh/cask/multipass)

  Once you have setup multipass locally,
  Run this command and give `admin` as passphrase

  ```sh
  multipass set local.passphrase
  ```

  Then, run the below command and when prompted for passphrase, give `admin`

  ```sh
  multipass auth
  ```

- **OpenLens**: [OpenLens](https://formulae.brew.sh/cask/openlens)

  Once you have openlens installed, go to extensions and install `@alebcay/openlens-node-pod-menu` extension.

- **Ansible**: [Ansible](https://formulae.brew.sh/formula/ansible)
- **Helm**: [Helm](https://formulae.brew.sh/formula/helm)
- Ensure all code repositories are cloned in the workspace in a single workspace folder.
- A github token with permissions to read and write packages.
- Settings > Privacy & Security > Local Network and ensure the app you are using to run the Multipass CLI is enabled - Terminal, Iterm2, Visual Studio code and chrome or any browser you are using.

### SSH Key Setup

- Ensure the SSH key `~/.ssh/id_rsa` is present on your system:

  ```sh
  ls -la ~/.ssh/
  ```

- If not, create the SSH keys:

  ```sh
  ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
  ```

- Press **Enter** to accept the default file location (`~/.ssh/id_rsa`).
- When prompted, enter a secure passphrase - leave it empty.

- To add the key to the SSH agent, run:

  ```sh
  eval "$(ssh-agent -s)"
  ssh-add ~/.ssh/id_rsa
  ```

## Local Build Process

### Exporting Environment Variables

- Replace the placeholder values with actual values:

  ```sh
  export DOCKER_BUILDKIT=1
  export AZ_USERNAME=""
  export AZ_PASSWORD=""
  export AZ_TENANT=""
  export GITOPS_USER_GITHUB_TOKEN=""
  ```

### Building Docker Images (First Time)

1. Pull the code from the main branch before running the script or any branch you would like.
2. Here are the services which are used in control plane:

   ```sh
    keycloak-customizations
    admin-service
    config-service
    datamigrator-ui
    db-writer
    jobs-service
    reports-service
    db-migrations
    support-service
   ```

3. Run the build script:

   ```sh
   cd app-deployment/local-deployment/bin
   ./build.sh --initial-build
   ```

4. Verify the Docker images:

   ```sh
   cd app-deployment/local-deployment/bin
   docker load --input ../../../app-deployment/datamigrator/datamigrator.tar
   ```

### Installing Datamigrator Control Plane on MicroK8s

- Run the setup script:

  ```sh
  cd app-deployment/local-deployment/bin
  ./setup.sh control-plane
  ```

### Installing Datamigrator Data Plane

#### Before running the script download the binary from github

1. Download the binary from the [artifactory](https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/builds/worker/branches/) for your branch, or use the binary from the latest commit on the main branch.
   **Note:** Access to this artifactory requires VPN.
   After downloading, extract the zip file and take the path of the `worker-linux-arm64` binary (MacOS).
2. Note the path of the binary and copy it.
3. Run the script and when prompted, provide the full path to the binary on your local Mac:

   ```sh
   cd app-deployment/local-deployment/bin
   ./setup.sh data-plane
   ```

### Installing NFS Server on Multipass

- Run the setup script:

  ```sh
  cd app-deployment/local-deployment/bin
  ./nfs.sh
  ```

### Updating Docker Config Registry with Multipass IP of Control Plane

- Once you have configured the control plane, update the Docker settings.
  Retrieve the Multipass IP:

  ```sh
  multipass list | grep datamigrator-cp | awk '{print $3}'
  ```

- Go to **Docker Desktop** > **Settings** > **Docker Engine**,  
  Replace the `IP_ADDRESS` with your Multipass IP:

  ```json
  "insecure-registries": [
    "IP_ADDRESS:32000"
  ]
  ```

### Application Access

NOTE: All credentials are managed from openbao. Replace the `IP_ADDRESS` with your Multipass IP.

1. Fetch the control plane multipass IP

   ```sh
   multipass list | grep datamigrator-cp | awk '{print $3}'
   ```

2. Fetch the openbao root token

   ```sh
   multipass shell datamigrator-cp
   sudo su - datamigrator
   cat /opt/datamigrator/openbao/cluster-keys.json
   ```

3. Login to openbao UI - `https://IP_ADDRESS/ui/` and give the root token for login. All application secrets are stored in openbao. Navigate to secrets after opening the openbao ui.
4. Keycloak UI - `https://IP_ADDRESS/keycloak/`
5. NDM UI - `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
6. Temporal UI - `https://IP_ADDRESS/temporal/ui/`
7. Postgres connection - Use the multipass IP to connect to postgres database. Get the username, password from openbao. Keys are - `POSTGRES_DMADMIN_USER` and `POSTGRES_DMADMIN_PASSWORD`.

### Setting Up Worker (Initial Build)

1. Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`. The initial username is `admin@datamigrator.local` and password is `Welcome@123`.
2. Create a project.
3. Click on "View instructions to set up worker".
4. SSH into the worker Multipass server:

   ```sh
   multipass shell datamigrator-worker
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

## Quick Reference: Recovering from Failed Ansible Steps

If Control Plane Ansible playbook step fails (e.g., `configure-postgres.yaml`), you can use the corresponding uninstall variable to clean up any partial state and safely retry from that step.


### How to Recover from a Failed Step

If your control plane setup fails partway through, follow these steps to continue from the point of failure:

1. **Edit your master playbook:**  
   Open `app-deployment/ansible/control-plane/playbooks/master-playbook.yaml` and comment out all steps above the failed playbook step.  
   _For example, if the failure happened at `configure-postgres.yaml`, comment out all previous steps but **leave** `configure-postgres.yaml` and all steps after it uncommented._

2. **Run the uninstall for the failed step:**  
   From `app-deployment/local-deployment/bin`, run the following command to clean up any partial setup for the failed component and restart the execution:

   ```sh
   ansible-playbook -i ../../ansible/control-plane/config/inventory.yaml ../../ansible/control-plane/playbooks/master-playbook.yaml -e local_cluster=true -e <uninstall_variable>=true
   ```
   _Example for Postgres:_
   ```sh
   ansible-playbook -i ../../ansible/control-plane/config/inventory.yaml ../../ansible/control-plane/playbooks/master-playbook.yaml -e local_cluster=true -e postgres_uninstall=true
   ```


### Uninstall Variables Table

You can use the following uninstall variables for each component, substituting `<uninstall_variable>` in the above command as needed:

| Component            | Playbook                        | Uninstall Variable     |
|----------------------|---------------------------------|------------------------|
| OpenBao              | configure-openbao.yaml          | openbao_uninstall      |
| Postgres             | configure-postgres.yaml         | postgres_uninstall     |
| Prometheus           | configure-prometheus.yaml       | prometheus_uninstall   |
| Fluentd              | configure-fluentd.yaml          | fluentd_uninstall      |
| OpenTelemetry (OTel) | configure-otel.yaml             | otel_uninstall         |
| Grafana              | configure-grafana.yaml          | grafana_uninstall      |
| Redis                | configure-redis-standalone.yaml | redis_uninstall        |
| Temporal             | configure-temporal.yaml         | temporal_uninstall     |
| Keycloak             | configure-keycloak.yaml         | keycloak_uninstall     |
| Datamigrator         | configure-datamigrator.yaml     | dm_uninstall           |


## Application Upgrades

### Building Docker Images

- To build and push a Docker image for a single service:

  ```sh
  cd app-deployment/local-deployment/bin
  ./build.sh admin-service <tag>
  ```

- For example, this will build the image for admin service and admin service liquibase. It will also push to the Multipass MicroK8s registry.

  ```sh
  cd app-deployment/local-deployment/bin
  ./build.sh admin-service new_tag
  ```

### Deploying New Changes to Docker Images

1. Build and push the Docker image using the steps mentioned above.
2. If no tag is specified, the default tag `latest` will be used. Replace tags with your tags. Override tags by passing variables as follows:

   ```sh
   ansible-playbook -i ansible/control-plane/config/inventory.yaml ansible/control-plane/playbooks/helm-upgrade.yaml -e local_cluster=true -e "datamigrator_ui_tag=latest config_service_tag=latest db_writer_service_tag=latest jobs_service_tag=latest file_service_tag=latest reports_service_tag=latest admin_service_tag=latest keycloak_customizations_tag=latest db_migrations_tag=latest support_service_tag=latest"
   ```

- For example, if you want to deploy the admin service build in the last step:

  ```sh
  ansible-playbook -i ansible/control-plane/config/inventory.yaml ansible/control-plane/playbooks/helm-upgrade.yaml -e local_cluster=true -e "datamigrator_ui_tag=latest config_service_tag=latest db_writer_service_tag=latest jobs_service_tag=latest file_service_tag=latest reports_service_tag=latest admin_service_tag=new_tag keycloak_customizations_tag=latest db_migrations_tag=latest support_service_tag=latest"
  ```

Notice the tag for `admin_service_tag` is changed.

<span style="color:red">**NOTE:** Ensure that the tags for other services match their currently deployed versions. If an older tag is used, it may replace the current pod with an older version. Always track the running versions..</span>

3. Navigate to OpenLens and select the `datamigrator` namespace.
4. Validate that all pods are up and running.

### Deploying a New Worker Binary

1. Download the binary from the worker repository, extract the zip file and take the path of `worker-linux-arm64` binary (MacOS).
2. Note the path of the binary and copy it.
3. Run the following playbook from the root folder, replacing `local_binary_path` with your path:

   ```sh
   ansible-playbook -i ansible/worker/config/inventory.yaml ansible/worker/playbooks/master-playbook.yaml -e local_cluster=true -e local_worker_update=true -e local_binary_path="/path/to/local/binary/"
   ```

4. SSH into the worker server and verify that the worker is running:

   ```sh
   multipass shell datamigrator-worker
   sudo su - datamigrator
   sudo systemctl status datamigrator-worker.service
   ```

5. Check the logs using the following command:

   ```sh
   tail -20f /opt/datamigrator/logs/datamigrator-worker.log
   ```

## Commands reference

### kubectl commands reference

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

### Multipass commands reference

- To list all instances:

  ```sh
  multipass list
  ```

- To open a shell session in an instance:

  ```sh
  multipass shell <instance-name>
  ```

- To delete an instance:

  ```sh
  multipass delete <instance-name>
  multipass purge
  ```

### Unseal openbao

- If you encounter an issue where openbao is sealed, follow these steps to unseal openbao.
- SSH into the control plane VM

  ```sh
  multipass shell datamigrator-cp
  ```

- Replace OPENBAO_UNSEAL_KEY with your key

  ```sh
  sudo su - datamigrator
  jq -r ".unseal_keys_b64[]" /opt/datamigrator/openbao/cluster-keys.json
  kubectl exec openbao-0 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  kubectl exec openbao-1 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  kubectl exec openbao-2 -n openbao -- bao operator unseal <OPENBAO_UNSEAL_KEY>
  ```

### Debug worker service

- SSH into the worker VM

  ```sh
  multipass shell datamigrator-worker
  ```

- Verify the status of the worker:

  ```sh
  systemctl status datamigrator-worker.service
  ```

- Check the logs using the following command:

  ```sh
  tail -20f /opt/datamigrator/logs/datamigrator-worker.log
  ```

## Troubleshooting Common Issues

### Helm Chart Installation Errors

If you encounter the error "Upgrade failed: another operation (install/upgrade/rollback) is in progress" when installing Helm charts:

1. SSH into the control plane VM:

   ```sh
   multipass shell datamigrator-cp
   ```

2. Check for secrets in the datamigrator namespace:

   ```sh
   kubectl get secrets -n datamigrator
   ```

3. Delete the secret(s):

   ```sh
   kubectl delete secrets <secret-names> -n datamigrator
   ```

4. Run the installation/upgrade command again.
