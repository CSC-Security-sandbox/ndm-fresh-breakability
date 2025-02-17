#!/bin/bash

# Set VM name and export directory
VM_NAME="datamigrator-nfs"
EXPORT_DIR="/srv/nfs_share"

# check if multipass is installed or not
if ! command -v multipass &> /dev/null
then
    echo "multipass could not be found"
    echo "Please install multipass and try again"
    exit
else
    echo "multipass is installed"
fi

if multipass list | grep -q $VM_NAME
then
    echo "$VM_NAME vm is already present"
    echo "Please delete the existing $VM_NAME vm and try again"
    echo "multipass delete $VM_NAME"
    echo "multipass purge"
    exit
fi

# Launch a new Multipass VM
multipass launch -c 1 -m 2g -d 10g -n "$VM_NAME" --cloud-init - <<-EOF
#cloud-config
package_update: true
packages:
  - nfs-kernel-server
runcmd:
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
  # Create 1000 empty files in the export directory
  - for i in \$(seq -w 0001 1000); do touch $EXPORT_DIR/file_\$i.txt; done
EOF

status=$(multipass info $VM_NAME | grep 'State' | awk '{print $2}')
while [ "$status" != "Running" ]
do
    echo "Waiting for $VM_NAME vm to be in running state; current state: $status"
    sleep 5
    status=$(multipass info $VM_NAME | grep 'State' | awk '{print $2}')
done

# Retrieve the IP address of the VM
VM_IP=$(multipass info $VM_NAME | grep 'IPv4' | awk '{print $2}')

# Display the VM IP address
echo "NFS server is set up in VM '$VM_NAME' with IP address: $VM_IP"
echo "The NFS share is located at: $EXPORT_DIR"