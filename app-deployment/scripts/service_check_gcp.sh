#!/bin/bash
# Usage: ./service_check_gcp.sh <ip_address> <username> <ssh_key_path>

IP=$1
USERNAME=$2
SSH_KEY_PATH=$3
SERVICE="boot-microk8s.service"
TIMEOUT=1800
INTERVAL=30
ELAPSED=0

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

if [ -z "$SSH_KEY_PATH" ] || [ ! -f "$SSH_KEY_PATH" ]; then
  echo "ERROR: SSH key path not provided or file not found: $SSH_KEY_PATH"
  exit 1
fi

SSH_CMD="ssh $SSH_OPTS -i $SSH_KEY_PATH"

echo "Monitoring service $SERVICE on $IP (timeout: ${TIMEOUT}s, interval: ${INTERVAL}s)"

# Wait for SSH to become available (VM may still be booting)
SSH_WAIT_MAX=300
SSH_WAIT_ELAPSED=0
SSH_WAIT_INTERVAL=15
echo "Waiting for SSH to become available on $IP..."
while [ $SSH_WAIT_ELAPSED -lt $SSH_WAIT_MAX ]; do
  if $SSH_CMD $USERNAME@$IP "echo ssh_ready" 2>/dev/null | grep -q "ssh_ready"; then
    echo "SSH is available on $IP after ${SSH_WAIT_ELAPSED}s"
    break
  fi
  echo "SSH not ready yet (${SSH_WAIT_ELAPSED}s/${SSH_WAIT_MAX}s), retrying in ${SSH_WAIT_INTERVAL}s..."
  sleep $SSH_WAIT_INTERVAL
  SSH_WAIT_ELAPSED=$((SSH_WAIT_ELAPSED + SSH_WAIT_INTERVAL))
done

if [ $SSH_WAIT_ELAPSED -ge $SSH_WAIT_MAX ]; then
  echo "ERROR: SSH did not become available on $IP within ${SSH_WAIT_MAX}s"
  exit 1
fi

# Get service status
echo "Service status:"
$SSH_CMD $USERNAME@$IP "sudo systemctl status $SERVICE" 2>/dev/null

while [ $ELAPSED -lt $TIMEOUT ]; do
  
  SERVICE_STATE=$($SSH_CMD $USERNAME@$IP "sudo systemctl show $SERVICE -p ActiveState,SubState --no-pager" 2>/dev/null || echo "Error: Could not retrieve service status")
                
  echo "Service Status: (${ELAPSED}s)"
  echo "$SERVICE_STATE"

  # Check for completion
  COMPLETED=$($SSH_CMD $USERNAME@$IP "sudo grep -q 'Datamigrator Application Setup Complete' /opt/datamigrator/logs/ndm-first-boot.log && echo yes || echo no" 2>/dev/null || echo "unknown")
  
  if [ "$COMPLETED" = "yes" ]; then
    echo "======================================"
    echo "FOUND COMPLETION MARKER IN LOGS - SERVICE SETUP COMPLETED SUCCESSFULLY"
    echo "======================================"
    echo "FULL SERVICE LOGS:"
    echo "======================================"
    
    $SSH_CMD $USERNAME@$IP "sudo cat /opt/datamigrator/logs/ndm-first-boot.log" 2>/dev/null || echo "Could not retrieve logs"
    
    echo "======================================"
    echo "END OF LOGS"
    echo "======================================"
    exit 0
  fi
  
  echo "Waiting ${INTERVAL} seconds before next check..."
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "======================================"
echo "TIMEOUT WAITING FOR SERVICE TO COMPLETE"
echo "======================================"
echo "LAST SERVICE STATUS:"
$SSH_CMD $USERNAME@$IP "sudo systemctl status $SERVICE" 2>/dev/null

echo "PARTIAL LOGS (LAST 50 LINES):"
echo "======================================"
$SSH_CMD $USERNAME@$IP "sudo tail -n 50 /opt/datamigrator/logs/ndm-first-boot.log" 2>/dev/null || echo "Could not retrieve logs"
echo "======================================"

exit 1
