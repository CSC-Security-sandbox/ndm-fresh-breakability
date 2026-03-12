#!/bin/bash

# Set VM names and export directory
SRC_VM_NAME="datamigrator-src-nfs"
TARGET_VM_NAME="datamigrator-target-nfs"
EXPORT_DIR="/srv/nfs_share"

# Function to check if a VM exists
check_vm_exists() {
  local vm_name=$1
  if multipass list | grep -q $vm_name
  then
    echo "$vm_name vm is already present"
    echo "Please delete the existing $vm_name vm and try again"
    echo "multipass delete $vm_name"
    echo "multipass purge"
    exit
  fi
}

# Function to launch a VM
launch_vm() {
  local vm_name=$1
  local create_files=$2
  multipass launch -c 1 -m 2g -d 10g -n "$vm_name" --network en0 --cloud-init - <<-EOF
#cloud-config
package_update: true
packages:
  - nfs-kernel-server
runcmd:
  # Remove default route added by the bridged network interface
  - sudo ip route delete 0.0.0.0/0 via 192.168.2.1 || true
  # Create the export directory
  - mkdir -p $EXPORT_DIR
  # Set permissions
  - chown nobody:nogroup $EXPORT_DIR
  - chmod 755 $EXPORT_DIR
  # Configure NFS exports
  - echo "$EXPORT_DIR *(rw,sync,no_subtree_check,no_root_squash,no_all_squash,insecure)" >> /etc/exports
  # Apply the NFS export configuration
  - exportfs -a
  # Restart the NFS server to apply changes
  - systemctl restart nfs-kernel-server
  # Create files in the export directory if specified
  - if [ "$create_files" = "true" ]; then for i in \$(seq -w 0001 1000); do touch $EXPORT_DIR/file_\$i.txt; done; fi
EOF
}

# Check if multipass is installed
if ! command -v multipass &> /dev/null
then
  echo "multipass could not be found"
  echo "Please install multipass and try again"
  exit
else
  echo "multipass is installed"
fi

# Check if VMs already exist
check_vm_exists $SRC_VM_NAME
check_vm_exists $TARGET_VM_NAME

# Launch the source VM with 1000 files
launch_vm $SRC_VM_NAME true

# Launch the target VM without creating files
launch_vm $TARGET_VM_NAME false

# Function to wait for a VM to be in running state
wait_for_vm() {
  local vm_name=$1
  status=$(multipass info $vm_name | grep 'State' | awk '{print $2}')
  while [ "$status" != "Running" ]
  do
    echo "Waiting for $vm_name vm to be in running state; current state: $status"
    sleep 5
    status=$(multipass info $vm_name | grep 'State' | awk '{print $2}')
  done
}

# Wait for both VMs to be in running state
wait_for_vm $SRC_VM_NAME
wait_for_vm $TARGET_VM_NAME

# Retrieve the IP addresses of the VMs
SRC_VM_IP=$(multipass info $SRC_VM_NAME | grep 'IPv4' | awk '{print $2}')
TARGET_VM_IP=$(multipass info $TARGET_VM_NAME | grep 'IPv4' | awk '{print $2}')

# Display the VM IP addresses
echo "NFS server is set up in VM '$SRC_VM_NAME' with IP address: $SRC_VM_IP"
echo "The NFS share is located at: $EXPORT_DIR"
echo "NFS server is set up in VM '$TARGET_VM_NAME' with IP address: $TARGET_VM_IP"
echo "The NFS share is located at: $EXPORT_DIR"