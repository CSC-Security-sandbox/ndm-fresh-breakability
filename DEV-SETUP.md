# app-deployment
This README has the instructions to setup microk8s cluster on local.

#### Pre-requisites (Mac OS)

Ensure the required tools are installed on your machine:
1. Docker Desktop: https://docs.docker.com/desktop/setup/install/mac-install/
2. Azure CLI: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos
3. Multipass: https://formulae.brew.sh/cask/multipass
4. OpenLens: https://formulae.brew.sh/cask/openlens

#### Ensure SSH key "~/.ssh/id_rsa" is present on your system:
```
ls -la ~/.ssh/
```
If not, create the SSH keys:
```
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```
Press **Enter** to accept the default file location (`~/.ssh/id_rsa`).  
When prompted, enter a secure passphrase, leave it empty.  

To add the key to the SSH agent, run:
```
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_rsa
```

#### Exporting Environment Variables 

Replace the values with actuals
```
export DOCKER_BUILDKIT=1
export AZ_USERNAME=""
export AZ_PASSWORD=""
export AZ_TENANT=""
export GITOPS_USER_GITHUB_TOKEN=""
```

#### Running the build script for docker images

1. Take pull in all services from main branch before running the script.
2. Run the script as follows:
```
cd local-deployment/bin
./build.sh --initial-build
```
3. Once the script has run successfully, verify the docker images using the following command:
```
cd local-deployment/bin
docker load --input ../../../app-deployment/datamigrator/datamigrator.tar
```

#### Running the setup script for installing datamigrator on microk8s
```
cd local-deployment/bin
./setup.sh
```

#### Update the docker config registry with multipass IP 

```
multipass list | grep datamigrator | awk '{print $3}'
```
Go to **Docker Desktop** > **Settings** > **Docker Engine**,  
Replace the `IP_ADDRESS` with your multipass IP:
```
  "insecure-registries": [
    "IP_ADDRESS:32000"
  ]
```

#### Building individual service

When building a docker image for a single service, use the following process:

```
cd local-deployment/bin
./build.sh admin-service
```

#### Deploying new changes to docker images

1. Build and push docker image using the above-mentioned steps.
2. Run the playbook by overriding the tags:
```
ansible-playbook -i ansible/control-plane/config/inventory.yaml ansible/control-plane/playbooks/helm-upgrade.yaml -e local_cluster=true
```
3. Navigate to OpenLens and select the `datamigrator` namespace.
4. Validate all pods are up and running.
