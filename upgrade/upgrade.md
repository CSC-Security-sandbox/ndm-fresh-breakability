# Steps to Upgrade Control Plane

## NDM Side

# NDM Side
1. Create a release branch `release/2025.08.17-preview` from the main branch on GitHub.

2. Run the release workflow on the `release/2025.08.17-preview` branch to upload the Helm chart and Docker image to Artifactory.
    Verify the upload by navigating to https://generic.repo.eng.netapp.com/artifactory/openlab-generic/cicd/ndm/releases and confirming that 
    the release branch contains both the Docker tar file and Helm chart (.tgz file).
 

3. Run the `create-upgrade-bundle.sh` with release name as input
```
$ cd ndm/upgrade
$ ./create-upgrade-bundle.sh 2025.08.17-preview
```

4. Give this zip to customers. 

## Customer Side

### Prerequisites
Stop all jobs from the NDM UI before proceeding.

### Upgrade Steps

1.Stop all jobs from the NDM UI before proceeding

2. Copy the zip file to the Control Plane machine:
```bash
scp -P 2226 ~/2025.08.19-preview.zip ubuntu@localhost:/tmp
```

3. SSH to CP machine and switch to datamigrator user
```
$ sudo su - datamigrator
```

4. Install unzip and unzip the upgrade bundle in /tmp folder
```
$ cd /tmp
$ sudo apt install unzip
$ unzip 2025.08.19-preview.zip
```

5. Make the upgrade script executable and run it
```
$ cd 2025.08.19-preview
$ chmod +x upgrade.sh
$ ./upgrade.sh  <path-to-check-sum-file> <path-to-docker-tar-file> <path-to-helm-tgz-file>

# Example:
./upgrade.sh checksums.sha256 datamigrator-2025.08.19-preview.tar datamigrator-2025.08.19-preview.tgz
```

6. Restart all the stop jobs and the migration must resume .

## Steps to Upgrade Worker

### Linux
Create a new VM from the released image and attach it to NDM.

### Windows
Uninstall the existing application and install the new executable on the Windows machine.
