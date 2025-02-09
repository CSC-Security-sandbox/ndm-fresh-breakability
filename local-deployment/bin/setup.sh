#!/bin/bash

# check if multipass is installed or not
if ! command -v multipass &> /dev/null
then
    echo "multipass could not be found"
    echo "Please install multipass and try again"
    exit
else
    echo "multipass is installed"
fi

# check if ansible is installed or not
if ! command -v ansible-playbook &> /dev/null
then
    echo "ansible could not be found"
    echo "Please install ansible and try again"
    exit
else
    echo "ansible is installed"
fi

# check if azure cli is installed or not
if ! command -v az &> /dev/null
then
    echo "azure cli could not be found"
    echo "Please install azure cli and try again"
    exit
else
    echo "azure cli is installed"
fi

# check if AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set or not
if [ -z "$AZ_USERNAME" ] || [ -z "$AZ_PASSWORD" ] || [ -z "$AZ_TENANT" ]
then
    echo "Please set the AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables"
    exit
else
    echo "AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set"
fi

# chceck if GITOPS_USER_GITHUB_TOKEN environment variable is set or not
if [ -z "$GITOPS_USER_GITHUB_TOKEN" ]
then
    echo "Please set the GITOPS_USER_GITHUB_TOKEN environment variable"
    exit
else
    echo "GITOPS_USER_GITHUB_TOKEN environment variable is set"
fi

# check if datamigrator vm is already present 
if multipass list | grep -q datamigrator
then
    echo "datamigrator vm is already present"
    echo "Please delete the existing datamigrator vm and try again"
    echo "multipass delete datamigrator"
    echo "multipass purge"
    exit
fi

# echo "Launching datamigrator vm"
multipass launch -c 6 -m 8g -d 100g -n datamigrator

status=$(multipass list | grep datamigrator | awk '{print $2}')
while [ "$status" != "Running" ]
do
    echo "Waiting for datamigrator vm to be in running state; current state: $status"
    sleep 5
    status=$(multipass list | grep datamigrator | awk '{print $2}')
done

# parse the ip address of datamigrator vm
ip_address=$(multipass list | grep datamigrator | awk '{print $3}')
echo "Datamigrator vm is launched successfully. IP Address: $ip_address"

cat ~/.ssh/id_rsa.pub | multipass exec datamigrator -- bash -c 'cat >> ~/.ssh/authorized_keys'

echo "" >> ~/.ssh/config
echo "Host $ip_address" >> ~/.ssh/config
echo "  AddKeysToAgent yes" >> ~/.ssh/config
echo "  IdentityFile ~/.ssh/id_rsa" >> ~/.ssh/config
echo "  PubkeyAcceptedAlgorithms +ssh-rsa" >> ~/.ssh/config
echo "  HostkeyAlgorithms +ssh-rsa" >> ~/.ssh/config
echo "  StrictHostKeyChecking no" >> ~/.ssh/config
echo "  UserKnownHostsFile /dev/null" >> ~/.ssh/config

# create inventory.yaml file in ../ansible/config directory
ansible_dir="../../ansible/control-plane/config"
inventory_file="$ansible_dir/inventory.yaml"

echo "all:" > $inventory_file
echo "  hosts:" >> $inventory_file
echo "    default:" >> $inventory_file
echo "      ansible_host: $ip_address" >> $inventory_file
echo "      ansible_user: ubuntu" >> $inventory_file
echo "      ansible_ssh_private_key_file: ~/.ssh/id_rsa" >> $inventory_file

ansible-playbook ../../ansible/control-plane/playbooks/local-playbook.yaml -i ../../ansible/control-plane/config/inventory.yaml 
