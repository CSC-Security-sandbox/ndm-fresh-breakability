#!/bin/bash

# Function to display help
display_help() {
    echo "Usage: $0 [control-plane|data-plane]"
    echo
    echo "Options:"
    echo "  control-plane   Create control-plane VM"
    echo "  data-plane      Create data-plane VM"
    exit 1
}

# Check if the correct number of arguments is provided
if [ $# -ne 1 ]; then
    display_help
fi

# Validate the input argument
if [[ "$1" != "control-plane" && "$1" != "data-plane" ]]; then
    echo "Invalid option: $1"
    display_help
fi

# Function to check if a command is installed
check_command() {
    if ! command -v $1 &> /dev/null
    then
        echo "$1 could not be found"
        echo "Please install $1 and try again"
        exit 1
    else
        echo "$1 is installed"
    fi
}

# Check required commands
check_command ansible-playbook
check_command az


# check if AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set or not
if [ -z "$AZ_USERNAME" ] || [ -z "$AZ_PASSWORD" ] || [ -z "$AZ_TENANT" ]
then
    echo "Please set the AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables"
    exit 1
else
    echo "AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set"
fi

# Main logic based on input parameter

ip_address=""
worker_binary_path=""
ssh_private_key_path=""
remote_user="root"

### Take input from user for ip_address and ssh_private_key_path
echo "Enter the IP address of the VM: "
read ip_address

echo "Enter the path to the SSH private key: "
read ssh_private_key_path

echo "Enter remote user (default: ubuntu): "
read remote_user

echo "IP Address: $ip_address"
echo "SSH Private Key: $ssh_private_key_path"
echo "Remote User: $remote_user"

# Create inventory.yaml file for $vm_name
case $1 in
    control-plane)
        # Create inventory.yaml file for $vm_name
        ansible_dir="../../ansible/control-plane/config"
        inventory_file="$ansible_dir/inventory.yaml"

        echo "all:" > $inventory_file
        echo "  hosts:" >> $inventory_file
        echo "    default:" >> $inventory_file
        echo "      ansible_host: $ip_address" >> $inventory_file
        echo "      ansible_user: ${remote_user}" >> $inventory_file
        echo "      ansible_ssh_private_key_file: ${ssh_private_key_path}" >> $inventory_file

        ansible-playbook ../../ansible/control-plane/playbooks/master-playbook.yaml -i $inventory_file -e vm_deployment=true

        ;;

    data-plane)
        echo "Enter the path to the worker binary: "
        read worker_binary_path

        # Create inventory.yaml file for $vm_name
        ansible_dir="../../ansible/worker/config"
        worker_inventory_file="$ansible_dir/inventory.yaml"

        echo "all:" > $worker_inventory_file
        echo "  hosts:" >> $worker_inventory_file
        echo "    default:" >> $worker_inventory_file
        echo "      ansible_host: $ip_address" >> $worker_inventory_file
        echo "      ansible_user: ubuntu" >> $worker_inventory_file
        echo "      ansible_ssh_private_key_file: ${ssh_private_key_path}" >> $worker_inventory_file

        ansible-playbook ../../ansible/worker/playbooks/master-playbook.yaml -i $worker_inventory_file -e local_binary_path=$worker_binary_path -e vm_deployment=true
        ;;

    *)
        display_help
        ;;
esac