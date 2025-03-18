# app-deployment

This repository contains Packer configurations integrated with Ansible to automate the setup and packaging of datamigrator application. It creates VM images for AWS, Azure, and GCP, pre-configured with the application and its dependencies.

## Prerequisites

Ensure the required tools are installed on your machine:

1. Packer
2. Docker

## Exporting AWS Variables

```
export AWS_ACCESS_KEY_ID="<your-access-key>"
export AWS_SECRET_ACCESS_KEY="<your-secret-key>"
```

## Exporting Azure Variables

```
export ARM_CLIENT_ID="<azure_client_id>"
export ARM_CLIENT_SECRET="<azure_client_secret>"
export ARM_SUBSCRIPTION_ID="<azure_subscription_id>"
export ARM_TENANT_ID="<azure_tenant_id>"
```

## Running the Packer Command for control plane

Navigate to the packer/control-plane directory to execute the Packer build process.

### Initialize Packer

Run the following command to initialize the Packer configuration:

```
cd packer/control-plane
packer init -var-file=cloud-packer.json ubuntu-packer-cloud.pkr.hcl
```

### Validate Configuration

To validate the Packer configuration, run:

```
packer validate -var-file=cloud-packer.json ubuntu-packer-cloud.pkr.hcl
```

### Build Command

Run the following command to build the cloud image:

```
packer build -var-file=cloud-packer.json ubuntu-packer-cloud.pkr.hcl
```

## Running the Packer Command for worker

Navigate to the packer/worker directory to execute the Packer build process.

### Initialize Packer

Run the following command to initialize the Packer configuration:

```
cd packer/worker
packer init -var-file=cloud-packer.json -var "worker_binary_path=/path/to/binary/worker-linux-x64" ubuntu-packer-cloud.pkr.hcl
```

### Validate Configuration

To validate the Packer configuration, run:

```
packer validate -var-file=cloud-packer.json -var "worker_binary_path=/path/to/binary/worker-linux-x64" ubuntu-packer-cloud.pkr.hcl
```

### Build Command

Run the following command to build the cloud image:

```
packer build -var-file=cloud-packer.json -var "worker_binary_path=/path/to/binary/worker-linux-x64" ubuntu-packer-cloud.pkr.hcl
```

## Building the Windows Worker Installer

To build the Windows Worker installer, you need to:

1. Download and install [Inno Setup](https://jrsoftware.org/isinfo.php)
2. Download [WinSW](https://github.com/winsw/winsw/releases) (a suitable version, e.g., `WinSW-x64.exe
`) and rename it to `winsw.exe`.
3. Rename the binary to `worker.exe` and place the `winsw.exe` and `worker.exe` into the `wininstaller` directory.
4. Open the `installer.iss` file in Inno Setup.
5. Build the installer by running "Compile" from the "Build" menu, or pressing Ctrl+F9.

This will generate the `datamigrator-worker-setup.exe` installer in the `wininstaller` directory.
