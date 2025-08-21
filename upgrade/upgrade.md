# Steps to upgrade control plane 


# NDM Side

1. Run the `create-upgrade-bundle.sh` with release name as input
```
$ ./create-upgrade-bundle.sh 2025.08.17-preview
```

2. Give this zip to customers. 


# User Side 

## Prerequisites
Stop all the jobs from the NDM UI

# Steps to upgrade
1. SCP the zip to the CP machine
```
scp -P 2226 ~/2025.08.19-preview.zip ubuntu@localhost:/tmp
```

2. SSH to CP machine and switch to datamigrator user
```
sudo su - datamigrator
```

3. Install unzip and unzip the upgrade bundle in /tmp folder
```
sudo apt install unzip
unzip 2025.08.17184143.zip
```

4. Make the upgrade script executable and run it
```
$ cd upgrade
$ chmod +x upgrade.sh
$ ./upgrade.sh  <path-to-check-sum-file> <path-to-docker-tar-file> <path-to-helm-tgz-file>

Example : ./upgrade.sh checksums.sha256 datamigrator-2025.08.19-preview.tar  datamigrator-2025.08.19-preview.tgz
```

# Steps to upgrade Worker
## LINUX
1. Create a new VM from the released image and attach the new worker to NMD.

## Windows
1. Uninstall and Re-install the new exe on the Windows machine. 
