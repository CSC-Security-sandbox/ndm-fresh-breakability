#!/bin/bash
set -euo pipefail

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Configuring network..."

netmask_to_cidr() {
    local mask=$1
    local IFS=.
    local cidr=0
    for octet in $mask; do
        bin=$(echo "obase=2; $octet" | bc)
        ones=$(echo "$bin" | tr -cd '1' | wc -c)
        cidr=$((cidr + ones))
    done
    echo "$cidr"
}

# Find the first non-loopback interface
for iface in $(ls /sys/class/net | grep -v '^lo$'); do
    IFACE="$iface"
    MAC=$(cat /sys/class/net/$IFACE/address)
    break
done

if [[ -z "${IFACE:-}" || -z "${MAC:-}" ]]; then
    log "No valid non-loopback network interface found!"
    exit 1
fi

log "Found interface: $IFACE with MAC: $MAC"

cat > /etc/netplan/01-netcfg.yaml <<EOF
network:
  version: 2
  ethernets:
    ${IFACE}:
      match:
        macaddress: "${MAC}"
      set-name: ${IFACE}
EOF

# Prepare DNS addresses list
DNS_ADDRESSES=()
if [[ -n "${DNS_SERVER_PRIMARY:-}" ]]; then
    DNS_ADDRESSES+=("${DNS_SERVER_PRIMARY}")
fi
if [[ -n "${DNS_SERVER_SECONDARY:-}" ]]; then
    DNS_ADDRESSES+=("${DNS_SERVER_SECONDARY}")
fi

# Prepare search domains YAML if provided (CSV expected)
SEARCH_LINE=""
if [[ -n "${SEARCH_DOMAINS:-}" ]]; then
    sd_clean=$(echo "$SEARCH_DOMAINS" | \
        tr ',' '\n' | \
        sed 's/^[ \t]*//;s/[ \t]*$//' | \
        grep -v '^$' | \
        paste -sd, -)
    SEARCH_LINE="        search: [${sd_clean}]"
fi

if [[ -n "${IP_ADDRESS:-}" && -n "${NETMASK:-}" && -n "${GATEWAY:-}" && ${#DNS_ADDRESSES[@]} -gt 0 ]]; then
    CIDR=$(netmask_to_cidr "$NETMASK")
    log "Applying static IP configuration: ${IP_ADDRESS}/${CIDR}, Gateway: ${GATEWAY}"
cat >> /etc/netplan/01-netcfg.yaml <<EOF
      dhcp4: no
      addresses: [${IP_ADDRESS}/${CIDR}]
      routes:
        - to: 0.0.0.0/0
          via: ${GATEWAY}
      nameservers:
        addresses: [$(IFS=, ; echo "${DNS_ADDRESSES[*]}")]
${SEARCH_LINE}
EOF
    log "Static IP configuration applied."
else
cat >> /etc/netplan/01-netcfg.yaml <<EOF
      dhcp4: yes
      dhcp6: yes
EOF
    log "No static IP provided, falling back to DHCP."
fi

chmod 600 /etc/netplan/01-netcfg.yaml
log "Applying netplan configuration..."
netplan apply
log "Network configuration applied successfully."
