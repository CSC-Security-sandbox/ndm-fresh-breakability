#!/bin/bash

set -e

echo "=== NDM Upgrade Script ==="
echo

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to install Ansible based on the OS
install_ansible() {
    echo "Installing Ansible..."
    
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command_exists brew; then
            brew install ansible
        else
            echo "Error: Homebrew not found. Please install Homebrew first."
            exit 1
        fi
    elif [[ -f /etc/redhat-release ]]; then
        # RHEL/CentOS/Fedora
        sudo yum install -y epel-release
        sudo yum install -y ansible
    elif [[ -f /etc/debian_version ]]; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y software-properties-common
        sudo add-apt-repository --yes --update ppa:ansible/ansible
        sudo apt-get install -y ansible
    else
        echo "Error: Unsupported operating system"
        exit 1
    fi
}

# Check if Ansible is installed
if command_exists ansible; then
    echo "Ansible is already installed: $(ansible --version | head -n1)"
else
    install_ansible
fi

# Verify Ansible installation
if ! command_exists ansible-playbook; then
    echo "Error: ansible-playbook command not found after installation"
    exit 1
fi

echo
echo "Running ansible-playbook..."
echo

# Run the ansible-playbook command
ansible-playbook \
    -i ansible/control-plane/config/local-inventory.yaml \
    ansible/control-plane/playbooks/helm-upgrade.yaml \
    -e local_cluster=false \
    -e "datamigrator_ui_tag=latest config_service_tag=latest db_writer_service_tag=latest jobs_service_tag=latest file_service_tag=latest reports_service_tag=latest admin_service_tag=latest keycloak_customizations_tag=latest db_migrations_tag=latest"

echo
echo "=== Upgrade completed successfully ==="
