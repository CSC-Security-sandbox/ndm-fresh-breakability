# App Deployment

This README provides instructions to set up a MicroK8s cluster locally.

## Pre-requisites (Mac OS)

Ensure the following tools are installed on your machine:
1. [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/)
2. [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos)
3. [Multipass](https://formulae.brew.sh/cask/multipass)
4. [OpenLens](https://formulae.brew.sh/cask/openlens)

## SSH Key Setup

Ensure the SSH key `~/.ssh/id_rsa` is present on your system:
```sh
ls -la ~/.ssh/
```
If not, create the SSH keys:
```sh
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```
Press **Enter** to accept the default file location (`~/.ssh/id_rsa`).  
When prompted, enter a secure passphrase - leave it empty.

To add the key to the SSH agent, run:
```sh
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_rsa
```

## Exporting Environment Variables

Replace the placeholder values with actual values:
```sh
export DOCKER_BUILDKIT=1
export AZ_USERNAME=""
export AZ_PASSWORD=""
export AZ_TENANT=""
export GITOPS_USER_GITHUB_TOKEN=""
```

## Building Docker Images

1. Pull all services from the main branch before running the script or any branch you would like.
2. Run the build script:
```sh
cd local-deployment/bin
./build.sh --initial-build
```
3. Verify the Docker images:
```sh
cd local-deployment/bin
docker load --input ../../../app-deployment/datamigrator/datamigrator.tar
```

## Installing Datamigrator Control Plane on MicroK8s

Run the setup script:
```sh
cd local-deployment/bin
./setup.sh control-plane
```

## Installing Datamigrator Data Plane

When prompted, provide the full path to the binary on your local Mac:
```sh
cd local-deployment/bin
./setup.sh data-plane
```

## Installing NFS Server on Multipass

Run the setup script:
```sh
cd local-deployment/bin
./nfs.sh
```

## Updating Docker Config Registry with Multipass IP of Control Plane

Retrieve the Multipass IP:
```sh
multipass list | grep datamigrator-cp | awk '{print $3}'
```
Go to **Docker Desktop** > **Settings** > **Docker Engine**,  
Replace the `IP_ADDRESS` with your Multipass IP:
```json
"insecure-registries": [
  "IP_ADDRESS:32000"
]
```

## Building Individual Service

To build a Docker image for a single service:
```sh
cd local-deployment/bin
./build.sh admin-service <tag>
```

## Deploying New Changes to Docker Images

1. Build and push the Docker image using the steps mentioned above.
2. If no tag is specified, the default tag `latest` will be used. Override tags by passing variables as follows:
```sh
ansible-playbook -i ansible/control-plane/config/inventory.yaml ansible/control-plane/playbooks/helm-upgrade.yaml -e local_cluster=true -e "data_migrate_ui_tag=latest config_service_tag=latest config_service_liquibase_tag=latest db_writer_service_tag=latest admin_service_liquibase_tag=latest jobs_service_tag=latest jobs_service_liquibase_tag=latest file_service_tag=latest reports_service_tag=latest reports_service_liquibase_tag=latest admin_service_tag=latest db_writer_service_liquibase_tag=latest keycloak_customizations_tag=latest"
```
3. Navigate to OpenLens and select the `datamigrator` namespace.
4. Validate that all pods are up and running.

## Setting Up Worker (Initial Build)

1. Navigate to the Datamigrator UI on the control plane IP: `https://IP_ADDRESS/`
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

## Deploying a New Worker Binary

1. Download the binary from the worker repository, extract the zip file and take the path of worker-linux-arm64 binary (MacOs).
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