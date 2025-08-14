# Setup.

Place the docker-compose directory at the same level as the `ndm` repo.

## In the docker-compose directory given by Abhishek.

> ./bin/start-local-docker-compose.sh

## URLs.

### Access keycloak first.
https://localhost:7443

### Now open data migrator UI.
http://localhost:3111
User name: admin@datamigrator.local
Password: welcome

### Temporal.
http://localhost:8090

## Start a worker.

### Update .env WORKER_ID and WORKER_SECRET from "Add worker instructions" in the control plane.
> export GITOPS_USER_GITHUB_TOKEN=$(gh auth token)

### In the ndm/services/worker path.
> npm install
> npm run start

# NFS servers.

Create the storage server by accessing the data migrator UI. Associate the worker with each src and dst storage service that you create.

## Create your own local NFS server in a VM to read/write.

Tested with an Ubuntu VM (guest) running in UTM on a Macbook (host). The Macbook (host) also has the data migrator worker.

### Create a VM.

Install UTM.
```sh
brew install --cask utm
```

There are plenty of online guides that demonstrate how to install and start a Ubuntu VM with UTM.

### Network setup.

I'll assume that the IP address of the guest is `10.0.1.2` (I used this as the source NFS server). I configured another VM with IP `10.0.1.3` (destination NFS server).

I used `Host Only` networking with `Guest Network` in `Advanced Settings` configured to be `10.0.1.0/24`.

### Configure NFS server on the guest.

All these commands are executed on the guest/Ubuntu VM (both the source and destination).

#### Install the NFS server.

```sh
sudo apt-get install -y nfs-kernel-server
```

#### Find your user and group IDs.

```sh
id
```

Note down the uid and gid numeric values. They were both 1000 in my case.

#### Edit exports.

Edit /etc/exports to look like this.

```sh
/srv/swbuild     *(rw,sync,no_subtree_check,root_squash,all_squash,anonuid=1000,anongid=1000,insecure)
```

- `/srv/swbuild` is the export path.
- Populate `anonuid` and `anongid` with the values from the `id` command that you executed before.
- `insecure` allows NFS clients to use non-privileged ports.

#### Restart NFS server.

```sh
sudo exportfs -rav
sudo systemctl daemon-reload
sudo systemctl restart nfs-kernel-server
```

### Test NFS client from our host.

#### Verify exports are visible.


```sh
showmount -e 10.0.1.2
```

#### Mount.

```sh
mkdir -p ~/Desktop/mnt/swbuild
mount -t nfs -o rw,vers=3,tcp 10.0.1.2:/srv/swbuild ~/Desktop/mnt/swbuild
```

#### Unmount.

```sh
umount ~/Desktop/mnt/swbuild
```
