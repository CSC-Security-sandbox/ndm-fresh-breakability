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
check_command multipass
check_command ansible-playbook
check_command az

# check if ~/.ssh/id_rsa is present
if [ ! -f ~/.ssh/id_rsa ]
then
    echo "SSH private key ~/.ssh/id_rsa is missing"
    echo "Please generate an SSH key using 'ssh-keygen' and try again"
    exit 1
else
    echo "SSH private key ~/.ssh/id_rsa is present"
fi

# check if AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set or not
if [ -z "$AZ_USERNAME" ] || [ -z "$AZ_PASSWORD" ] || [ -z "$AZ_TENANT" ]
then
    echo "Please set the AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables"
    exit 1
else
    echo "AZ_USERNAME, AZ_PASSWORD and AZ_TENANT environment variables are set"
fi

# check if GITOPS_USER_GITHUB_TOKEN environment variable is set or not
if [ -z "$GITOPS_USER_GITHUB_TOKEN" ]
then
    echo "Please set the GITOPS_USER_GITHUB_TOKEN environment variable"
    exit 1
else
    echo "GITOPS_USER_GITHUB_TOKEN environment variable is set"
fi

# Main logic based on input parameter
case $1 in
    control-plane)
        vm_name="datamigrator-cp"
        if multipass list | grep -q $vm_name
        then
            echo "$vm_name vm is already present"
            echo "Please delete the existing $vm_name vm and try again"
            echo "multipass delete $vm_name"
            echo "multipass purge"
            exit
        fi
        # Launch $vm_name vm
        
        echo "Launching $vm_name vm"

        multipass launch -c 8 -m 8g -d 120g -n $vm_name

        # Wait for the VM to be in the 'Running' state
        while [ "$(multipass info $vm_name | grep 'State' | awk '{print $2}')" != "Running" ]; do
            echo "Waiting for $vm_name vm to be in running state..."
            sleep 5
        done

        # Retrieve the IP address of the VM
        ip_address=$(multipass info $vm_name | grep 'IPv4' | awk '{print $2}')
        echo "$vm_name vm is launched successfully. IP Address: $ip_address"

        # Add your SSH key to the VM's authorized_keys
        multipass exec $vm_name -- bash -c "echo $(cat ~/.ssh/id_rsa.pub) >> ~/.ssh/authorized_keys"

        # Update SSH config
        {
            echo ""
            echo "Host $ip_address"
            echo "  AddKeysToAgent yes"
            echo "  IdentityFile ~/.ssh/id_rsa"
            echo "  PubkeyAcceptedAlgorithms +ssh-rsa"
            echo "  HostkeyAlgorithms +ssh-rsa"
            echo "  StrictHostKeyChecking no"
            echo "  UserKnownHostsFile /dev/null"
        } >> ~/.ssh/config

        # Create inventory.yaml file for $vm_name
        ansible_dir="../../ansible/control-plane/config"
        inventory_file="$ansible_dir/inventory.yaml"

        echo "all:" > $inventory_file
        echo "  hosts:" >> $inventory_file
        echo "    default:" >> $inventory_file
        echo "      ansible_host: $ip_address" >> $inventory_file
        echo "      ansible_user: ubuntu" >> $inventory_file
        echo "      ansible_ssh_private_key_file: ~/.ssh/id_rsa" >> $inventory_file

        # Build Wasm extension and package Helm chart
        echo ""
        echo "=========================================="
        echo "Building Wasm extension for Redis JWT..."
        echo "=========================================="
        
        wasm_dir="../../wasm/redis-jwt-auth"
        if [ -d "$wasm_dir" ]; then
            echo "Building Wasm binary..."
            (cd "$wasm_dir" && make docker-build)
            
            echo "Copying Wasm binary to Helm chart..."
            mkdir -p ../../ansible/control-plane/roles/datamigrator/helm-chart/package/wasm
            cp "$wasm_dir/redis-jwt-auth.wasm" ../../ansible/control-plane/roles/datamigrator/helm-chart/package/wasm/
            
            echo "Wasm extension ready"
        else
            echo "Wasm directory not found, skipping Wasm build"
        fi
        
        echo ""
        echo "=========================================="
        echo "Packaging Helm chart..."
        echo "=========================================="
        
        # Get absolute paths
        script_dir="$(cd "$(dirname "$0")" && pwd)"
        ansible_base="$script_dir/../../ansible/control-plane"
        
        cd "$ansible_base/playbooks"
        ansible-playbook package-helm-chart.yaml \
            -i ../config/local-inventory.yaml \
            --extra-vars "build_version=0.1.0" \
            --extra-vars "@../config/group_vars/all.yaml"
        cd - > /dev/null
        
        echo "Helm chart packaged"
        echo ""

        # Run master playbook from playbooks directory to resolve vars.yaml paths
        cd "$ansible_base/playbooks"
        ansible-playbook master-playbook.yaml -i ../config/inventory.yaml -e local_cluster=true
        cd - > /dev/null
        ;;
    data-plane)
        # Get user input for worker binary path
        vm_name="datamigrator-worker"
        read -p "Please provide the path to the worker binary: " worker_binary_path
        if multipass list | grep -q $vm_name
        then
            echo "$vm_name vm is already present"
            echo "Please delete the existing $vm_name vm and try again"
            echo "multipass delete $vm_name"
            echo "multipass purge"
            exit
        fi

        echo "Launching $vm_name vm"
        multipass launch -c 4 -m 4g -d 30g -n $vm_name

        # Wait for the VM to be in the 'Running' state
        while [ "$(multipass info $vm_name | grep 'State' | awk '{print $2}')" != "Running" ]; do
            echo "Waiting for $vm_name vm to be in running state..."
            sleep 5
        done

        # Retrieve the IP address of the VM
        ip_address=$(multipass info $vm_name | grep 'IPv4' | awk '{print $2}')
        echo "$vm_name vm is launched successfully. IP Address: $ip_address"

        # Add your SSH key to the VM's authorized_keys
        multipass exec $vm_name -- bash -c "echo $(cat ~/.ssh/id_rsa.pub) >> ~/.ssh/authorized_keys"

        # Update SSH config
        {
            echo ""
            echo "Host $ip_address"
            echo "  AddKeysToAgent yes"
            echo "  IdentityFile ~/.ssh/id_rsa"
            echo "  PubkeyAcceptedAlgorithms +ssh-rsa"
            echo "  HostkeyAlgorithms +ssh-rsa"
            echo "  StrictHostKeyChecking no"
            echo "  UserKnownHostsFile /dev/null"
        } >> ~/.ssh/config

        # Create inventory.yaml file for $vm_name
        ansible_dir="../../ansible/worker/config"
        worker_inventory_file="$ansible_dir/inventory.yaml"

        echo "all:" > $worker_inventory_file
        echo "  hosts:" >> $worker_inventory_file
        echo "    default:" >> $worker_inventory_file
        echo "      ansible_host: $ip_address" >> $worker_inventory_file
        echo "      ansible_user: ubuntu" >> $worker_inventory_file
        echo "      ansible_ssh_private_key_file: ~/.ssh/id_rsa" >> $worker_inventory_file

        ansible-playbook ../../ansible/worker/playbooks/master-playbook.yaml -i $worker_inventory_file -e local_binary_path=$worker_binary_path -e local_cluster=true
        ;;

    *)
        display_help
        ;;
esac