#!/bin/bash

# Script to cleanup stale GCNV clone volumes from Google Cloud NetApp Volumes
# Handles both NFS and SMB clone volumes
# Protects all master volumes and AD server volumes defined in .env
# Prompts for confirmation before deleting each volume
#
# Usage:
#   ./cleanup-gcnv-clone-volumes.sh          # Interactive mode - prompts before each deletion
#   ./cleanup-gcnv-clone-volumes.sh --yes    # Auto-confirm all deletions without prompting
#   ./cleanup-gcnv-clone-volumes.sh -y       # Same as --yes
#   ./cleanup-gcnv-clone-volumes.sh --help   # Show help message
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - jq installed (brew install jq)
#   - .env file in the same directory with GCP_GCNV_PROJECT_ID, GCP_GCNV_LOCATION,
#     and GCP_NFS_*/GCP_SMB_* volume variables configured
#
# Protected volumes (will NOT be deleted):
#   - All master NFS volumes (GCP_NFS_SOURCE_VOLUMES, GCP_NFS_DEST_VOLUMES)
#   - All master SMB volumes (GCP_SMB_SOURCE_VOLUMES, GCP_SMB_DEST_VOLUMES)
#   - All AD server SMB shares (GCP_AD_SMB_SOURCE_VOLUMES, AZURE_AD_SMB_SOURCE_VOLUMES)
#   - Any volume with label "donot-delete: true"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "Error: .env file not found in $SCRIPT_DIR"
    exit 1
fi

source "$SCRIPT_DIR/.env"

AUTO_CONFIRM=false

usage() {
    echo "Usage: $0 [--yes]"
    echo ""
    echo "Options:"
    echo "  --yes, -y    Delete all matched clones without prompting"
    echo "  --help, -h   Show this help message"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --yes|-y)
            AUTO_CONFIRM=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Error: Unknown option: $1"
            echo ""
            usage
            exit 1
            ;;
    esac
done

if ! command -v gcloud >/dev/null 2>&1; then
    echo "Error: gcloud CLI is not installed. Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is not installed. Install with: brew install jq"
    exit 1
fi

trim() {
    echo "$1" | xargs
}

# ===== Collect protected volumes =====

PROTECTED_VOLUMES=()

add_csv_volumes() {
    local csv="$1"
    IFS=',' read -ra VOLS <<< "$csv"
    for vol in "${VOLS[@]}"; do
        vol="$(trim "$vol")"
        [ -n "$vol" ] && PROTECTED_VOLUMES+=("$vol")
    done
}

# NFS master volumes
add_csv_volumes "${GCP_NFS_SOURCE_VOLUMES:-}"
add_csv_volumes "${GCP_NFS_DEST_VOLUMES:-}"

# SMB master volumes
add_csv_volumes "${GCP_SMB_SOURCE_VOLUMES:-}"
add_csv_volumes "${GCP_SMB_DEST_VOLUMES:-}"

# AD server SMB shares (not GCNV volumes, but protect if they appear)
add_csv_volumes "${GCP_AD_SMB_SOURCE_VOLUMES:-}"
add_csv_volumes "${AZURE_AD_SMB_SOURCE_VOLUMES:-}"

UNIQUE_PROTECTED=()
while IFS= read -r vol; do
    [ -n "$vol" ] && UNIQUE_PROTECTED+=("$vol")
done < <(printf '%s\n' "${PROTECTED_VOLUMES[@]}" | sort -u)

if [ ${#UNIQUE_PROTECTED[@]} -eq 0 ]; then
    echo "Error: No protected GCNV master volumes found in .env."
    echo "Set GCP_NFS_*_VOLUMES and/or GCP_SMB_*_VOLUMES before running cleanup."
    exit 1
fi

# ===== GCP config =====

GCP_PROJECT="${GCP_GCNV_PROJECT_ID:-}"
GCP_LOCATION="${GCP_GCNV_LOCATION:-}"

if [ -z "$GCP_PROJECT" ] || [ -z "$GCP_LOCATION" ]; then
    echo "Error: GCP_GCNV_PROJECT_ID and GCP_GCNV_LOCATION must be set in .env"
    exit 1
fi

# ===== Helper functions =====

is_protected() {
    local name="$1"
    for p in "${UNIQUE_PROTECTED[@]}"; do
        [ "$name" = "$p" ] && return 0
    done
    return 1
}

has_donot_delete_label() {
    local labels="$1"
    local donot_delete
    donot_delete=$(echo "$labels" | jq -r '.["donot-delete"] // ""')
    [ "$donot_delete" = "true" ] && return 0
    return 1
}

is_stale_test_clone() {
    local name="$1"
    for master in "${UNIQUE_PROTECTED[@]}"; do
        if [[ "$name" == "${master}-"* ]]; then
            local suffix="${name#${master}-}"
            if [[ "$suffix" =~ .+-[a-f0-9]{8}$ ]]; then
                echo "$master"
                return 0
            fi
        fi
    done
    return 1
}

wait_for_volume_deletion() {
    local vol_name="$1"
    local attempt

    for attempt in $(seq 1 60); do
        local output
        if output=$(gcloud netapp volumes describe "$vol_name" \
            --project="$GCP_PROJECT" \
            --location="$GCP_LOCATION" \
            --format="value(state)" 2>&1); then
            sleep 10
        else
            output_lower="$(printf '%s' "$output" | tr '[:upper:]' '[:lower:]')"
            if [[ "$output_lower" == *"not found"* ]] || [[ "$output_lower" == *"not_found"* ]]; then
                return 0
            fi
            sleep 10
        fi
    done
    return 1
}

# ===== Main =====

echo "=========================================="
echo "GCNV Volume Cleanup"
echo "Project:  $GCP_PROJECT"
echo "Location: $GCP_LOCATION"
echo "=========================================="
echo ""
echo "Protected Volumes (will NOT delete):"
echo "------------------------------------------"
for vol in "${UNIQUE_PROTECTED[@]}"; do
    echo "  + $vol"
done
echo ""

echo "Fetching GCNV volumes..."
volumes_json=$(gcloud netapp volumes list \
    --project="$GCP_PROJECT" \
    --location="$GCP_LOCATION" \
    --format="json(name.basename(),state,labels)" 2>&1)

if [ $? -ne 0 ]; then
    echo "Error: Failed to list GCNV volumes: $volumes_json"
    exit 1
fi

total=$(echo "$volumes_json" | jq '. | length')
echo "Found $total GCNV volume(s)"
echo ""

vols_to_delete=()
vols_to_delete_parents=()
kept=0
ignored=0

for i in $(seq 0 $((total - 1))); do
    name=$(echo "$volumes_json" | jq -r ".[$i].name")
    labels=$(echo "$volumes_json" | jq -c ".[$i].labels // {}")

    if is_protected "$name"; then
        kept=$((kept + 1))
        continue
    fi

    if has_donot_delete_label "$labels"; then
        kept=$((kept + 1))
        continue
    fi

    if parent=$(is_stale_test_clone "$name"); then
        vols_to_delete+=("$name")
        vols_to_delete_parents+=("$parent")
    else
        ignored=$((ignored + 1))
    fi
done

echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo "Protected (keeping):    $kept"
echo "Clones to delete:       ${#vols_to_delete[@]}"
echo "Other (ignoring):       $ignored"
echo ""

if [ ${#vols_to_delete[@]} -eq 0 ]; then
    echo "No stale GCNV clone volumes to cleanup!"
    exit 0
fi

echo "Clones to DELETE:"
echo "------------------------------------------"
for i in "${!vols_to_delete[@]}"; do
    idx=$((i + 1))
    echo "  ${idx}. ${vols_to_delete[$i]}  (clone of ${vols_to_delete_parents[$i]})"
done
echo ""

if [ "$AUTO_CONFIRM" != true ]; then
    echo "Interactive mode: you will be prompted before each deletion."
    echo ""
fi

deleted=0
failed=0
skipped=0

for i in "${!vols_to_delete[@]}"; do
    name="${vols_to_delete[$i]}"
    parent="${vols_to_delete_parents[$i]}"
    idx=$((i + 1))

    if [ "$AUTO_CONFIRM" != true ]; then
        printf "  [%d/%d] Delete '%s' (clone of %s)? (yes/no): " \
            "$idx" "${#vols_to_delete[@]}" "$name" "$parent"
        read -r confirm
        if [ "$confirm" != "yes" ]; then
            echo "         Skipped"
            skipped=$((skipped + 1))
            continue
        fi
    fi

    echo -n "  [${idx}/${#vols_to_delete[@]}] $name ... "

    if gcloud netapp volumes delete "$name" \
        --project="$GCP_PROJECT" \
        --location="$GCP_LOCATION" \
        --force \
        --quiet 2>/dev/null; then
        if wait_for_volume_deletion "$name"; then
            echo "Deleted"
            deleted=$((deleted + 1))
        else
            echo "Delete requested, but wait timed out"
            failed=$((failed + 1))
        fi
    else
        echo "Failed"
        failed=$((failed + 1))
    fi
done

echo ""
echo "=========================================="
echo "RESULTS"
echo "=========================================="
echo "Deleted:   $deleted"
echo "Skipped:   $skipped"
echo "Failed:    $failed"
echo ""

if [ "$failed" -ne 0 ]; then
    echo "GCNV volume cleanup finished with errors."
    exit 1
fi

echo "GCNV volume cleanup complete!"
