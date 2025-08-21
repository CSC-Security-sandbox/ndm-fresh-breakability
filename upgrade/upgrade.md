# Steps to Upgrade Control Plane

## NDM Side

1. Run `create-upgrade-bundle.sh` with the release name as input:
```bash
# Example:
./create-upgrade-bundle.sh 2025.08.17-preview
```

2. The script generates a zip file (e.g., `2025.08.17-preview.zip`). Provide this file to customers.

## Customer Side

### Prerequisites
Stop all jobs from the NDM UI before proceeding.

### Upgrade Steps

1. Copy the zip file to the Control Plane machine:
```bash
scp -P 2226 ~/2025.08.19-preview.zip ubuntu@localhost:/tmp
```

2. SSH into the Control Plane machine and switch to the datamigrator user:
```bash
sudo su - datamigrator
```

3. Install unzip and extract the upgrade bundle in the `/tmp` folder:
```bash
sudo apt install unzip
unzip 2025.08.17-preview.zip
```

4. Make the upgrade script executable and run it:
```bash
cd upgrade
chmod +x upgrade.sh
./upgrade.sh <path-to-checksum-file> <path-to-docker-tar-file> <path-to-helm-tgz-file>

# Example:
./upgrade.sh checksums.sha256 datamigrator-2025.08.19-preview.tar datamigrator-2025.08.19-preview.tgz
```

## Worker Upgrade Steps

### Linux
Create a new VM from the released image and attach it to NDM.

### Windows
Uninstall the existing application and install the new executable on the Windows machine.
