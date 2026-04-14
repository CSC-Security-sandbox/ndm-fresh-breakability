
This document highlights the process of adding an SCS-based GitHub custom runner to run the CI-CD pipeline.

## Provisioning the SCS V2 VM

SCS V2 VMs are provisioned through the NetApp Global Engineering Cloud (GEC) portal:
https://gec.netapp.com

Create an Ubuntu 24.04 VM on the SCS V2 (KVM) hypervisor. Once the VM is ready, note the IP address. The VM comes with a default root password — log in via SSH and change it to the password stored in the CyberArk Vault (see below).

## Prerequisites (macOS)

Install the following on your Mac before running the playbook:

```bash
brew install ansible sshpass
```

Download **ovftool for Linux** (required by CI workflows for vSphere/OVF builds):

1. Go to https://developer.broadcom.com/tools/open-virtualization-format-ovf-tool/latest
2. Download the **Linux** bundle (zip) — do **not** extract it
3. Note the path to the downloaded archive — the playbook copies it to the VM and extracts there

Retrieve the **root** credentials for the target SCS V2 VM from CyberArk:
https://pvwa.corp.netapp.com/PasswordVault/v10/

Verify SSH connectivity to the target SCS V2 VM:

```bash
ssh root@<VM_IP_ADDRESS>
```

The target Ubuntu 24.04 VM needs no additional setup — `openssh-server`, `python3`, and `sudo` are included in the standard server image. The playbook connects as `root` and creates a non-root `ubuntu` user for running the GitHub Actions runner service.

## Automated Setup (Recommended)

An Ansible playbook automates the full provisioning process. See [`app-deployment/ansible/scs-based-github-custom-runner/`](../app-deployment/ansible/scs-based-github-custom-runner/).

The playbook runs in two phases:

1. **Stage (Mac)** — downloads all external artifacts (Helm, Packer GPG key, govc, GitHub Actions runner) to a local staging directory on your Mac
2. **Install (VM)** — copies the staged artifacts to the SCS V2 VM and installs everything

This avoids network connectivity issues from the SCS V2 VM to external CDNs and GitHub.

```bash
# 1. Change to the playbook directory
cd app-deployment/ansible/scs-based-github-custom-runner

# 2. Copy the example inventory and fill in your VM details
#    (runner_name, runner_labels, ovftool_archive, credentials — all go in the inventory)
cp config/inventory.yaml.example config/inventory.yaml

# 3. Get a runner registration token from:
#    https://github.com/NetApp-Cloud-DataMigrate/ndm/settings/actions/runners

# 4. Run the playbook (only the ephemeral token needs to be passed on the command line)
ansible-playbook -i config/inventory.yaml playbooks/setup-scs-based-github-custom-runner.yaml \
  --extra-vars "runner_token=<TOKEN>"
```

### Optional flags

Run only prerequisites (skip runner registration):

```bash
ansible-playbook -i config/inventory.yaml playbooks/setup-scs-based-github-custom-runner.yaml --tags prerequisites
```

Override any defaults via `--extra-vars` (see `config/group_vars/all.yaml` for all available options):

```bash
ansible-playbook -i config/inventory.yaml playbooks/setup-scs-based-github-custom-runner.yaml \
  --extra-vars "runner_token=<TOKEN> tmp_tmpfs_size=8G tmp_cleanup_age=12h"
```

### /tmp management

SCS V2 VMs default to a 1GB tmpfs for `/tmp`, which is too small for tools like the BlackDuck Signature Scanner. Since tmpfs is RAM-backed, the playbook sets a conservative 5GB (configurable via `tmp_tmpfs_size`):

- **Larger tmpfs** — `/tmp` is resized from 1GB to 5GB
- **Periodic cleanup** — `systemd-tmpfiles-clean.timer` runs every 6 hours and removes files older than 1 day (configurable via `tmp_cleanup_age`)

To check the current state on a runner:

```bash
df -h /tmp
systemctl status systemd-tmpfiles-clean.timer
```

## Manual Setup

**Steps**

1. Create a VM on vSphere with ubuntu machine

2. Login using ssh  `ssh<user>@<Machine_IP> `
   Then install the following:

    - Install zip
        ```
        sudo apt install zip
        sudo apt install unzip
        ```

    - Install xorriso
        ```
        sudo apt-get install xorriso
        ```

    - Install Helm 
        ```
        curl https://baltocdn.com/helm/signing.asc | gpg --dearmor | sudo tee /usr/share/keyrings/helm.gpg > /dev/null
        sudo apt-get install apt-transport-https --yes
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
        sudo apt-get update
        sudo apt-get install helm
        ```


    - Install Ansible
        ```
        sudo apt update
        sudo apt install software-properties-common
        sudo add-apt-repository --yes --update ppa:ansible/ansible
        sudo apt install ansible
        ```


    - Install ovftool.

        Download ovftool https://developer.broadcom.com/tools/open-virtualization-format-ovf-tool/latest for mac, 
        Unzip it and using fileZilla move it to the VM

        Or you can do scp command. Replace `<LOCAL_PATH_TO_APP_DEPLOYMENT>` and `<LOCAL_PATH_TO_OVFTOOL>` with the respective paths on your local machine, and `<VM_IP_ADDRESS>` with the IP address of your VM.
        ```
        sudo ln -s /root/ovftool/ovftool /usr/local/bin/ovftool
        scp -r <LOCAL_PATH_TO_APP_DEPLOYMENT> root@<VM_IP_ADDRESS>:/root/
        scp -r <LOCAL_PATH_TO_OVFTOOL> root@<VM_IP_ADDRESS>:/root/ovftool/
        rsync -avz <LOCAL_PATH_TO_APP_DEPLOYMENT> ubuntu@<VM_IP_ADDRESS>:/home/ubuntu/rocky-app-deployment/
        ```



    - Install Packer
        ```
        wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
        sudo apt update && sudo apt install packer
        ```

    - Install PDF-Text(Poppler), ginkgo, jq, and azure-cli
        ```
        sudo apt-get update
        sudo apt-get install poppler-utils
        sudo apt install ginkgo
        sudo apt install jq
        sudo apt-get install azure-cli
        ```
    
    - Install GOVC tool.
        ```
        cat <<'EOF' > install_govc.sh
        #!/bin/sh

        if ! command -v govc >/dev/null 2>&1; then
            echo "Installing govc..."
            wget -q https://github.com/vmware/govmomi/releases/download/v0.51.0/govc_Linux_x86_64.tar.gz -O /tmp/govc_Linux_x86_64.tar.gz
            tar -xzf /tmp/govc_Linux_x86_64.tar.gz -C /tmp/
            sudo cp /tmp/govc /usr/local/bin/
            sudo chmod +x /usr/local/bin/govc
            rm -f /tmp/govc /tmp/govc_Linux_x86_64.tar.gz
        else
            echo "govc already exists..."
        fi
        EOF
        ```


3. Add runner to GitHub and run it as a service
    - Create a folder on the VM
        ```
        $ mkdir actions-runner && cd actions-runner
        ```
    - Download the latest runner package
        ```
        $ curl -o actions-runner-linux-x64-2.323.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-linux-x64-2.323.0.tar.gz
        ```
    - Optional: Validate the hash
        ```
        $ echo "0dbc9bf5a58620fc52cb6cc0448abcca964a8d74b5f39773b7afcad9ab691e19  actions-runner-linux-x64-2.323.0.tar.gz" | shasum -a 256 -c
        ```
    - Extract the installer
        ```
        $ tar xzf ./actions-runner-linux-x64-2.323.0.tar.gz
        ```


    - Configure: 
        You need token . 
        Go to https://github.com/NetApp-Cloud-DataMigrate/ndm/settings/actions/runners and try following the steps there 
        for Linux runner. 
        Use the token printed there in the below command and proceed
        ```
        $ ./config.sh --url https://github.com/NetApp-Cloud-DataMigrate --token <<TOKEN>>
        ```

    - Installing the service
        Stop the self-hosted runner application if it is currently running.
        
    - Install the service with the following command:
        ```
            sudo ./svc.sh install
        ```
    - Starting the service
        Start the service with the following command:
        ```
            sudo ./svc.sh start
        ```

    To allow passwordless sudo for all commands, run `sudo visudo` and add the following line:
    ```
        Add ubuntu ALL=(ALL) NOPASSWD:ALL
    ```
4. Add label to the runner
    Please refer https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/using-labels-with-self-hosted-runners#assigning-a-label-to-an-organization-runner
