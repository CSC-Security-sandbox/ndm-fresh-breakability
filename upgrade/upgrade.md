# Steps to upgrade control plane 


# NDM Side

1. Create the tar file from docker images and helm release by running the `Release Workflow` from the release branch

2. The above step will create the docker(.tar) and helm package(.tgz) here https://generic.repo.eng.netapp.com/artifactory/openlab-generic-local/cicd/ndm/releases/

3. Download the docker and helm locally and zip is along with the upgrade.sh. 
The `upgrade.sh` file is present in upgrade folder of ndm
```
$ zip -r 2025.08.17184143 upgrade/
```

4. Give this zip to customers. 


# User Side 

## Prerequisites
Stop all the jobs from the NDM UI

# Steps to upgrade
1. SCP the zip to the CP machine
```
scp -P 2226 ~/2025.08.10184143.zip ubuntu@localhost:/tmp
```

2. SSH to CP machine and switch to datamigrator user
```
sudo su - datamigrator
```

3. Unzip the upgrade bundle in /tmp folder
```
unzip 2025.08.17184143.zip
```

4. Make the upgrade script executable and run it
```
$ cd upgrade
$ chmod +x upgrade.sh
$ ./upgrade.sh <path-to-docker-tar-file> <path-to-helm-tgz-file>
```

# Steps to upgrade Worker
1. Create a new VM out of the release and attach the new worker.
