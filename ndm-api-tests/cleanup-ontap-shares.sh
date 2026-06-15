#!/bin/bash

# Script to cleanup test SMB shares from ONTAP, preserving only master volumes
# Deletes ONLY clones of master volumes (shares with master_*_suffix pattern)

set -euo pipefail

# Load ONTAP connection details from .env
if [ ! -f ".env" ]; then
    echo "Error: .env file not found in current directory"
    exit 1
fi

# Source .env file for ONTAP connection details only
source .env

# ONTAP API configuration
ONTAP_API_URL="${ONTAP_SRC_API_URL}"
ONTAP_USERNAME="${ONTAP_SYSTEM_MANAGER_SRC_USERNAME}"
ONTAP_PASSWORD="${ONTAP_SYSTEM_MANAGER_SRC_PASSWORD}"
ONTAP_SVM="${ONTAP_SRC_SVM_NAME}"

# Master volumes to PROTECT (hardcoded from .env reference)
# These are the base volumes that should NEVER be deleted
PROTECTED_SHARES=(
    # NFS Master Volumes
    "master_nfs_vol_dnd_src_automation_1"
    "master_nfs_vol_dnd_src_automation_2"
    "master_nfs_vol_dnd_src_automation_3"
    "master_nfs_vol_dnd_dest_automation_1"
    "master_nfs_vol_dnd_dest_automation_2"
    
    # SMB Master Volumes
    "master_smb_vol_dnd_src_automation_1"
    "master_smb_vol_dnd_src_automation_2"
    "master_smb_vol_dnd_src_automation_3"
    "master_smb_vol_dnd_src_automation_4_perms1"
    "master_smb_vol_dnd_dest_automation_1"
    "master_smb_vol_dnd_dest_automation_2"
    "master_smb_vol_dnd_dest_automation_3_perms2"
)

# Check for duplicates in protected shares
echo "=========================================="
echo "Protected Master Shares (will NOT delete):"
echo "=========================================="
UNIQUE_PROTECTED=($(printf '%s\n' "${PROTECTED_SHARES[@]}" | sort -u))
for share in "${UNIQUE_PROTECTED[@]}"; do
    echo "  ✓ $share"
done

# Check for duplicates (sanity check on hardcoded list)
if [ ${#UNIQUE_PROTECTED[@]} -ne ${#PROTECTED_SHARES[@]} ]; then
    echo ""
    echo "⚠️  WARNING: Found duplicate share names in hardcoded protected list!"
    echo "Original count: ${#PROTECTED_SHARES[@]}, Unique count: ${#UNIQUE_PROTECTED[@]}"
    echo "Fix the PROTECTED_SHARES array in this script."
fi

echo ""
echo "=========================================="
echo "Fetching SMB shares from ONTAP"
echo "=========================================="
echo "API URL: ${ONTAP_API_URL}"
echo "SVM:     ${ONTAP_SVM}"
echo ""

# Get all SMB shares from ONTAP
SHARES_JSON=$(curl -sk -u "${ONTAP_USERNAME}:${ONTAP_PASSWORD}" \
    -X GET "${ONTAP_API_URL}/api/protocols/cifs/shares?svm.name=${ONTAP_SVM}&fields=name,path" \
    -H "Accept: application/json")

# Check if curl succeeded
if [ $? -ne 0 ]; then
    echo "Error: Failed to fetch shares from ONTAP API"
    exit 1
fi

# Parse share names using jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Install with: brew install jq"
    exit 1
fi

ALL_SHARES=($(echo "$SHARES_JSON" | jq -r '.records[]?.name // empty'))

if [ ${#ALL_SHARES[@]} -eq 0 ]; then
    echo "No SMB shares found on SVM: ${ONTAP_SVM}"
    exit 0
fi

echo "Found ${#ALL_SHARES[@]} total SMB shares on SVM: ${ONTAP_SVM}"
echo ""

# Identify shares to delete (only clones)
SHARES_TO_DELETE=()
SHARES_TO_KEEP=()
SHARES_IGNORED=()

for share in "${ALL_SHARES[@]}"; do
    # Check if share is exactly in protected list
    IS_PROTECTED=false
    for protected in "${UNIQUE_PROTECTED[@]}"; do
        if [ "$share" == "$protected" ]; then
            IS_PROTECTED=true
            SHARES_TO_KEEP+=("$share")
            break
        fi
    done
    
    # If protected, skip to next
    if [ "$IS_PROTECTED" = true ]; then
        continue
    fi
    
    # Check if it's a clone of a protected share (master_*_suffix pattern)
    IS_CLONE=false
    for protected in "${UNIQUE_PROTECTED[@]}"; do
        if [[ "$share" == "${protected}"_* ]]; then
            IS_CLONE=true
            SHARES_TO_DELETE+=("$share")
            break
        fi
    done
    
    # If not a clone, it's an orphaned/system share - ignore it
    if [ "$IS_CLONE" = false ]; then
        SHARES_IGNORED+=("$share")
    fi
done

# Display summary
echo "=========================================="
echo "SUMMARY:"
echo "=========================================="
echo "Total shares found:     ${#ALL_SHARES[@]}"
echo "Protected (keeping):    ${#SHARES_TO_KEEP[@]}"
echo "Clones to delete:       ${#SHARES_TO_DELETE[@]}"
echo "Orphaned (ignoring):    ${#SHARES_IGNORED[@]}"
echo ""

if [ ${#SHARES_TO_KEEP[@]} -gt 0 ]; then
    echo "Shares to KEEP (master volumes):"
    for share in "${SHARES_TO_KEEP[@]}"; do
        echo "  ✓ $share"
    done
    echo ""
fi

if [ ${#SHARES_IGNORED[@]} -gt 0 ]; then
    echo "Shares IGNORED (not clones of master volumes):"
    for share in "${SHARES_IGNORED[@]}"; do
        echo "  ⊘ $share"
    done
    echo ""
fi

if [ ${#SHARES_TO_DELETE[@]} -eq 0 ]; then
    echo "✓ No cloned test shares to cleanup!"
    exit 0
fi

echo "Clones to DELETE (from master volumes):"
for share in "${SHARES_TO_DELETE[@]}"; do
    # Find which master volume this is a clone of
    for protected in "${UNIQUE_PROTECTED[@]}"; do
        if [[ "$share" == "${protected}"_* ]]; then
            echo "  🔸 $share (clone of $protected)"
            break
        fi
    done
done
echo ""

# Confirm deletion
read -p "⚠️  Proceed to interactive deletion of ${#SHARES_TO_DELETE[@]} cloned shares? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Aborted. No shares deleted."
    exit 0
fi

# Delete shares with per-share confirmation
echo ""
echo "=========================================="
echo "Deleting shares (interactive mode)..."
echo "=========================================="
echo "Press Enter to delete each share, or 's' to skip"
echo ""

DELETED_COUNT=0
FAILED_COUNT=0
SKIPPED_COUNT=0

for share in "${SHARES_TO_DELETE[@]}"; do
    # Show share info
    echo -n "Delete '$share'? (Enter=delete, s=skip): "
    read -r USER_INPUT
    
    if [ "$USER_INPUT" = "s" ] || [ "$USER_INPUT" = "S" ]; then
        echo "  ⏭️  Skipped"
        ((SKIPPED_COUNT++))
        continue
    fi
    
    # User pressed Enter or any other key - proceed with deletion
    echo -n "  Deleting... "
    
    # Truncate share name to 80 chars (ONTAP limit)
    TRUNCATED_SHARE="${share:0:80}"
    
    # Use query parameters instead of path parameters (ONTAP requires SVM UUID in path)
    HTTP_CODE=$(curl -sk -u "${ONTAP_USERNAME}:${ONTAP_PASSWORD}" \
        -X DELETE "${ONTAP_API_URL}/api/protocols/cifs/shares?svm.name=${ONTAP_SVM}&name=${TRUNCATED_SHARE}" \
        -H "Accept: application/json" \
        -w "%{http_code}" -o /tmp/delete_response.json)
    
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 204 ]; then
        echo "✓ Deleted"
        ((DELETED_COUNT++))
    elif [ "$HTTP_CODE" -eq 404 ]; then
        echo "⚠️  Not found (HTTP 404)"
        echo "    API Response: $(cat /tmp/delete_response.json 2>/dev/null)"
        ((DELETED_COUNT++))
    else
        echo "❌ Failed (HTTP $HTTP_CODE)"
        echo "    Response: $(cat /tmp/delete_response.json 2>/dev/null)"
        ((FAILED_COUNT++))
    fi
done

echo ""
echo "=========================================="
echo "CLEANUP COMPLETE"
echo "=========================================="
echo "Successfully deleted:   $DELETED_COUNT"
echo "Skipped:                $SKIPPED_COUNT"
echo "Failed:                 $FAILED_COUNT"
echo "Protected (kept):       ${#SHARES_TO_KEEP[@]}"
echo ""

if [ $FAILED_COUNT -gt 0 ]; then
    echo "⚠️  Some shares failed to delete. Check ONTAP logs for details."
    exit 1
fi

if [ $SKIPPED_COUNT -gt 0 ]; then
    echo "✓ Cleanup complete! ($SKIPPED_COUNT shares skipped)"
else
    echo "✓ All cloned test shares cleaned up successfully!"
fi
