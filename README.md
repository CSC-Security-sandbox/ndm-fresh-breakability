# app-deployment
This repository contains Packer configurations integrated with Ansible to automate the setup and packaging of datamigrate application. It creates VM images for AWS, Azure, and GCP, pre-configured with the application and its dependencies.

## Prerequisites

Ensure the required tools are installed on your machine:
1. Packer
2. Docker

## Exporting AWS Variables 
```
export AWS_ACCESS_KEY_ID="<your-access-key>"
export AWS_SECRET_ACCESS_KEY="<your-secret-key>"
```

## Storing Docker Images with MicroK8s Registry

Create "datamigrate" directory at root level to store tar file of docker images

### Building the Docker Image

To build a Docker image with a specific tag for the local MicroK8s registry, use the following command:
```
docker build -t localhost:32000/data-migrate-ui:1.0.4 .
```

### Saving the Docker Image

Once the image is built, save it to a file in the datamigrate directory. Replace <version> with the appropriate version, e.g., 1.0.4.
You can add multiple docker images in this tar file by passing additional docker images
```
docker save -o datamigrate/datamigrate_1.0.4.tar localhost:32000/data-migrate-ui:1.0.4
```

Note the version of the tar file as it will be later used in packer configuration.

## Running the Packer Command

Navigate to the packer/cloud directory to execute the Packer build process.
In the cloud-packer.json, update the "datamigrate_release_version" variable to the value of version in the tar file

### Initialize Packer

Run the following command to initialize the Packer configuration:
```
cd packer/cloud
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