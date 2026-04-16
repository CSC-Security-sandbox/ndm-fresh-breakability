#!/bin/bash
# Usage: ./service_check.sh <ip_address> <username> <password>

IP=$1
USERNAME=$2
PASSWORD=$3
SERVICE="boot-microk8s.service"
TIMEOUT=3600
INTERVAL=30
ELAPSED=0

echo "Monitoring service $SERVICE on $IP (timeout: ${TIMEOUT}s, interval: ${INTERVAL}s)"

# Get service status
echo "Service status:"
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
$USERNAME@$IP "sudo systemctl status $SERVICE" 2>/dev/null

while [ $ELAPSED -lt $TIMEOUT ]; do
  
  SERVICE_STATE=$(sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                $USERNAME@$IP "sudo systemctl show $SERVICE -p ActiveState,SubState --no-pager" 2>/dev/null || echo "Error: Could not retrieve service status")
                
  echo "Service Status: (${ELAPSED}s)"
  echo "$SERVICE_STATE"

  # Check for completion
  COMPLETED=$(sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            $USERNAME@$IP "sudo grep -q 'Datamigrator Application Setup Complete' /opt/datamigrator/logs/ndm-first-boot.log && echo yes || echo no" 2>/dev/null || echo "unknown")
  
  if [ "$COMPLETED" = "yes" ]; then
    echo "======================================"
    echo "FOUND COMPLETION MARKER IN LOGS - SERVICE SETUP COMPLETED SUCCESSFULLY"
    echo "======================================"
    echo "FULL SERVICE LOGS:"
    echo "======================================"
    
    # Display the full logs
    sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    $USERNAME@$IP "sudo cat /opt/datamigrator/logs/ndm-first-boot.log" 2>/dev/null || echo "Could not retrieve logs"
    
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
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
$USERNAME@$IP "sudo systemctl status $SERVICE" 2>/dev/null

echo "PARTIAL LOGS (LAST 50 LINES):"
echo "======================================"
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
$USERNAME@$IP "sudo tail -n 50 /opt/datamigrator/logs/ndm-first-boot.log" 2>/dev/null || echo "Could not retrieve logs"
echo "======================================"

exit 1