# Packer Documentation

This repository contains Packer configurations integrated with Ansible to automate the setup and packaging of the `datamigrator` application. It supports creating VM images for multiple cloud providers, including Azure, GCP, and VMware vSphere, pre-configured with the application and its dependencies. AWS support is now available.

## Prerequisites

Ensure the following tools are installed on your machine:
1. [Packer](https://www.packer.io/)
2. [Docker](https://www.docker.com/)
3. Export the required environment variables for authentication and configuration based on your provider. For example:

    **Azure:**
    ```bash
    export ARM_CLIENT_ID="your-client-id"
    export ARM_CLIENT_SECRET="your-client-secret"
    export ARM_SUBSCRIPTION_ID="your-subscription-id"
    export ARM_TENANT_ID="your-tenant-id"
    ```

    **GCP:**
    ```bash
    gcloud auth application-default login
    ```

    **VMware vSphere:**
    ```bash
    export PKR_vsphere_endpoint="your-vsphere-server"
    export PKR_vsphere_username="your-username"
    export PKR_vsphere_password="your-password"
    export PKR_build_username="your-build-username"
    export PKR_build_password="your-build-password"
    export PKR_build_password_encrypted="your-encrypted-build-password"
    export PKR_build_key="your-build-key"
    ```

    Replace the placeholders with the actual values for your cloud provider.

## Usage

Navigate to the appropriate folder based on your cloud provider and the type of image you want to build (control-plane or worker). For example:

- **Azure Control Plane:** `cd packer/azure/control-plane`
- **Azure Worker:** `cd packer/azure/worker`
- **GCP Control Plane:** `cd packer/gcp/control-plane`
- **GCP Worker:** `cd packer/gcp/worker`
- **VMware vSphere Control Plane:** `cd packer/vmware-vsphere/control-plane`
- **VMware vSphere Worker:** `cd packer/vmware-vsphere/worker`

Then, run the following commands:

1. Initialize Packer:
    ```bash
    packer init .
    ```

2. Validate the configuration:
    ```bash
    packer validate -var-file="variables.pkrvars.hcl" linux-ubuntu.pkr.hcl
    ```
    For worker images, include the `worker_binary_path` variable:
    ```bash
    packer validate -var "worker_binary_path=/path/to/binary/worker-linux-x64" -var-file="variables.pkrvars.hcl" linux-ubuntu.pkr.hcl
    ```

3. Build the image:
    ```bash
    packer build -on-error=ask -var-file="variables.pkrvars.hcl" linux-ubuntu.pkr.hcl
    ```
    For worker images, include the `worker_binary_path` variable:
    ```bash
    packer build -on-error=ask -var "worker_binary_path=/path/to/binary/worker-linux-x64" -var-file="variables.pkrvars.hcl" linux-ubuntu.pkr.hcl
    ```

Replace `/path/to/binary/worker-linux-x64` with the actual path to the worker binary if building a worker image.
