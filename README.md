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

Follow these steps to create the installer:

### Install Inno Setup

- Download and install [Inno Setup](https://jrsoftware.org/isinfo.php).
- This tool is used to build the Windows installer.

### Download WinSW

- Get a suitable version of [WinSW](https://github.com/winsw/winsw/releases), e.g., `WinSW-x64.exe`.
- Rename the downloaded file to `winsw.exe`.

### Prepare the Binaries

- Rename your worker binary to `worker.exe`.
- Place both `worker.exe` and `winsw.exe` into the `wininstaller` directory.

### Open the Inno Setup Script

- Launch Inno Setup.
- Open the `installer.iss` script file from the `wininstaller` directory.

### Build the Installer

- In Inno Setup, go to the **Build** menu and click **Compile**, or press `Ctrl + F9`.
- The installer `datamigrator-worker-setup.exe` will be generated inside the `wininstaller` directory.

## Requirements

### Microsoft Visual C++ Redistributable

- The worker requires C++ Redistributable package to be installed on the machine.

## Running the Installer

- Run `datamigrator-worker-setup.exe`.
- During setup, enter the following values when prompted:
  - **Worker ID**
  - **Worker Secret**
  - **Control Plane IP**
- Once installed, the Datamigrator Worker service starts automatically.
- The installation directory is:
  ```
  C:\datamigrator
  ```

## Checking Logs

### Log Location

- Logs can be found at:
  ```
  C:\datamigrator\logs
  ```

### Tail Logs in Real-Time

- Open **PowerShell** and run:
  ```powershell
  Get-Content -Path "C:\datamigrator\logs\DatamigratorWorker.out.log" -Wait
  ```
