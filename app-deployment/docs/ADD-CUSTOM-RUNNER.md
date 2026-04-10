
This document highlights the process of adding a custom runner to run CI-CD Pipeline.

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
        $ curl -o actions-runner-linux-x64-2.333.1.tar.gz -L https://github.com/actions/runner/releases/download/v2.333.1/actions-runner-linux-x64-2.333.1.tar.gz
        ```
    - Optional: Validate the hash
        ```
        $ echo "18f8f68ed1892854ff2ab1bab4fcaa2f5abeedc98093b6cb13638991725cab74  actions-runner-linux-x64-2.333.1.tar.gz" | shasum -a 256 -c
        ```
    - Extract the installer
        ```
        $ tar xzf ./actions-runner-linux-x64-2.333.1.tar.gz
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