#!/usr/bin/env bash
# =============================================================================
# smb_metadata_compare.sh
#
# Scans two SMB/CIFS shares hosted on a Windows machine, records per-entry
# metadata to TSV files, compares them field-by-field, and exits non-zero on
# any discrepancy.
#
# Metadata collected per entry:
#   path  type  mtime_epoch  atime_epoch  acl  checksum
#
# ACL is retrieved via getcifsacl(1) with ACE entries sorted for stable
# ordering.  The share must be mounted with the "cifsacl" option (default).
#
# Discrepancy report columns:
#   path  field  source_value  destination_value
#   src_acl  dst_acl  src_checksum  dst_checksum  checksum_match_status
#
# Speed strategy:
#   1. Source and destination are scanned concurrently (background jobs).
#   2. Within each scan, top-level subdirectories are walked in parallel
#      (--workers, default 8) so multiple CIFS stat streams run at once.
#   3. ACLs are fetched with xargs -P 4 inside each worker.
#   4. MD5 checksums are computed with xargs -P 4 inside each worker.
#
# Usage:
#   sudo ./smb_metadata_compare.sh \
#       --src            //172.30.202.5/src_share   \
#       --dst            //172.30.202.5/dst_share   \
#       --username       svc_account                \
#       --password       'p@ssword'                 \
#       [--domain        WORKGROUP]                 \
#       [--src-out       src_smb_metadata.tsv]      \
#       [--dst-out       dst_smb_metadata.tsv]      \
#       [--diff-out      smb_discrepancies.tsv]     \
#       [--workers       8]                         \
#       [--skip-checksum]
#
# Exit codes:
#   0 – all fields match
#   1 – one or more discrepancies found
#   2 – usage / argument error
#   3 – SMB mount / scan error
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SRC=""
DST=""
SMB_USER=""
SMB_PASS=""
SMB_DOMAIN="WORKGROUP"
SRC_OUT="src_smb_metadata.tsv"
DST_OUT="dst_smb_metadata.tsv"
DIFF_OUT="smb_discrepancies.tsv"
WORKERS=8
SKIP_CHECKSUM=0

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
    echo "Usage: sudo $0 --src <//host/share> --dst <//host/share>"
    echo "             --username <user> --password <pass>"
    echo "             [--domain        WORKGROUP]"
    echo "             [--src-out       src_smb_metadata.tsv]"
    echo "             [--dst-out       dst_smb_metadata.tsv]"
    echo "             [--diff-out      smb_discrepancies.tsv]"
    echo "             [--workers       8]"
    echo "             [--skip-checksum]   skip MD5 checksum (faster)"
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --src)            SRC="$2";        shift 2 ;;
        --dst)            DST="$2";        shift 2 ;;
        --username)       SMB_USER="$2";   shift 2 ;;
        --password)       SMB_PASS="$2";   shift 2 ;;
        --domain)         SMB_DOMAIN="$2"; shift 2 ;;
        --src-out)        SRC_OUT="$2";    shift 2 ;;
        --dst-out)        DST_OUT="$2";    shift 2 ;;
        --diff-out)       DIFF_OUT="$2";   shift 2 ;;
        --workers)        WORKERS="$2";    shift 2 ;;
        --skip-checksum)  SKIP_CHECKSUM=1; shift   ;;
        -h|--help)        usage ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$SRC" ]]      && { echo "ERROR: --src is required";      usage; }
[[ -z "$DST" ]]      && { echo "ERROR: --dst is required";      usage; }
[[ -z "$SMB_USER" ]] && { echo "ERROR: --username is required"; usage; }
[[ -z "$SMB_PASS" ]] && { echo "ERROR: --password is required"; usage; }

# ---------------------------------------------------------------------------
# Logging + timing helpers
# ---------------------------------------------------------------------------
# \r\033[K clears any stray carriage returns so parallel background logs stay clean.
log() { printf '\r\033[K[%s] %s\n' "${1}" "${*:2}" >&2; }

# elapsed_seconds <start_epoch_seconds>  →  prints "Xs" or "Xm Ys"
elapsed_fmt() {
    local secs=$(( $(date +%s) - $1 ))
    if (( secs < 60 )); then
        printf '%ds' "$secs"
    else
        printf '%dm %ds' "$(( secs / 60 ))" "$(( secs % 60 ))"
    fi
}

SCRIPT_START=$(date +%s)

# ---------------------------------------------------------------------------
# Ensure cifs-utils is installed (provides mount.cifs and getcifsacl)
# ---------------------------------------------------------------------------
ensure_smb_client() {
    local need_install=0
    command -v mount.cifs >/dev/null 2>&1 || need_install=1
    command -v getcifsacl >/dev/null 2>&1 || need_install=1

    if (( need_install )); then
        log "INFO" "mount.cifs / getcifsacl not found – installing cifs-utils..."
        sudo apt-get install -y cifs-utils >/dev/null 2>&1
    fi
}

# ---------------------------------------------------------------------------
# mount_smb <share> <mountpoint> <label> <cred_file>
# Tries SMB protocol versions from newest to oldest, then auto-negotiate.
# ---------------------------------------------------------------------------
mount_smb() {
    local share="$1" mp="$2" label="$3" cred_file="$4"

    for vers in "3.1.1" "3.0" "2.1" "2.0"; do
        log "INFO|$label" "Trying CIFS vers=$vers ..."
        if timeout 30 sudo mount -t cifs "$share" "$mp" \
            -o "ro,cifsacl,credentials=${cred_file},vers=${vers}" 2>/dev/null; then
            log "INFO|$label" "Mounted $share (vers=$vers, opts: ro,cifsacl)"
            return 0
        fi
        log "INFO|$label" "  → failed or timed out, trying next..."
    done

    # Final attempt: let the kernel negotiate the version
    log "INFO|$label" "Trying CIFS (auto-negotiate vers)..."
    if timeout 30 sudo mount -t cifs "$share" "$mp" \
        -o "ro,cifsacl,credentials=${cred_file}" 2>/dev/null; then
        log "INFO|$label" "Mounted $share (vers=auto)"
        return 0
    fi

    return 1
}

# ---------------------------------------------------------------------------
# scan_chunk <find_start> <prefix> <outfile> <label> <skip_checksum>
#
# Scans one directory chunk (top-level subdir or root):
#   1. find -printf  → metadata (path, type, mtime, atime)
#   2. getcifsacl    → Windows ACL per entry (xargs -P 4)
#   3. md5sum        → checksum per regular file (or "-" if --skip-checksum)
#   4. awk 3-way join → merged 6-column TSV chunk
#
# find -printf tokens used:
#   %P  relative path from the find start point
#   %y  type: f=file  d=directory  l=symlink
#   %T@ mtime epoch (decimal, sub-second)
#   %A@ atime epoch (decimal, sub-second)
#
# ACL string format (pipe-delimited, ACEs sorted for stable ordering):
#   REVISION:0x1|CONTROL:0x8004|OWNER:DOMAIN\user|GROUP:DOMAIN\grp|ACL:ace1|ACL:ace2
# ---------------------------------------------------------------------------
scan_chunk() {
    local find_start="$1"
    local prefix="$2"
    local outf="$3"
    local label="$4"
    local skip_cs="$5"

    local depth_opt
    # Root-level scan is maxdepth 1 only; subdir scans are fully recursive.
    [[ "$prefix" == "" ]] && depth_opt="-maxdepth 1 -mindepth 1" || depth_opt="-mindepth 1"

    local meta_tmp="${outf}.meta"
    local acl_tmp="${outf}.acl"
    local cksum_tmp="${outf}.cksum"

    # Step 1: collect path / type / mtime / atime via find -printf, sorted by path.
    # shellcheck disable=SC2086
    sudo find "$find_start" $depth_opt \
        -printf '%P\t%y\t%T@\t%A@\n' \
    | sort -t$'\t' -k1,1 > "$meta_tmp"

    # Step 2: fetch Windows ACLs via getcifsacl in parallel (4 workers).
    # Each output line: <rel_path>\t<normalized_acl_string>
    # ACE lines are sorted so that equivalent ACL sets compare equal regardless
    # of the order the Windows server returns them.
    # shellcheck disable=SC2086
    sudo find "$find_start" $depth_opt -print0 2>/dev/null \
    | xargs -0 -r -P 4 bash -c '
        strip="${1%/}"; shift
        for f in "$@"; do
            rel="${f#${strip}/}"
            # Fallback if the prefix strip did not match (e.g. root-level symlink)
            [[ "$rel" == "$f" ]] && rel="${f##*/}"

            raw=$(getcifsacl "$f" 2>/dev/null)
            if [[ -z "$raw" ]]; then
                printf "%s\tNO_ACL\n" "$rel"
                continue
            fi

            rev=$(  printf "%s" "$raw" | grep "^REVISION:" | head -1)
            ctrl=$( printf "%s" "$raw" | grep "^CONTROL:"  | head -1)
            owner=$(printf "%s" "$raw" | grep "^OWNER:"    | head -1)
            grp=$(  printf "%s" "$raw" | grep "^GROUP:"    | head -1)
            aces=$( printf "%s" "$raw" | grep "^ACL:"      | sort | tr "\n" "|")
            acl="${rev}|${ctrl}|${owner}|${grp}|${aces%|}"
            printf "%s\t%s\n" "$rel" "$acl"
        done
    ' _ "$find_start" \
    | sort -t$'\t' -k1,1 > "$acl_tmp"

    # Step 3: compute MD5 checksums for regular files.
    if (( skip_cs == 0 )); then
        # shellcheck disable=SC2086
        sudo find "$find_start" $depth_opt -type f -print0 2>/dev/null \
        | xargs -0 -r -P 4 md5sum 2>/dev/null \
        | awk -v strip="${find_start}/" '
            {
                hash = $1
                # md5sum format: "<32-char-hash>  <path>" (two spaces)
                fullpath = substr($0, 35)
                # strip binary-mode asterisk if present
                if (substr(fullpath,1,1) == "*") fullpath = substr(fullpath, 2)
                relpath = substr(fullpath, length(strip) + 1)
                print relpath "\t" hash
            }' \
        | sort -t$'\t' -k1,1 > "$cksum_tmp"
    else
        : > "$cksum_tmp"
    fi

    # Step 4: 3-way join – acl + checksum + meta → final TSV chunk.
    # ARGIND==1 → acl_tmp   builds acl[]   lookup table
    # ARGIND==2 → cksum_tmp builds cksum[] lookup table
    # ARGIND==3 → meta_tmp  is iterated and enriched
    #
    # NOTE: ARGIND (not NR==FNR) is used so that empty lookup files
    # (e.g. when --skip-checksum) do not cause meta rows to be misread.
    awk -v pfx="$prefix" -v skip="$skip_cs" -v OFS='\t' '
        ARGIND == 1 { acl[$1]   = $2; next }
        ARGIND == 2 { cksum[$1] = $2; next }
        {
            split($0, f, "\t")
            rel   = f[1]
            type  = f[2]
            mtime = f[3]
            atime = f[4]
            a = (rel in acl) ? acl[rel] : "NO_ACL"
            if (skip == 1) {
                c = "SKIPPED"
            } else {
                c = (type == "f") ? (rel in cksum ? cksum[rel] : "CHECKSUM_ERROR") : "-"
            }
            fp = (pfx != "") ? pfx "/" rel : rel
            print fp, type, mtime, atime, a, c
        }
    ' "$acl_tmp" "$cksum_tmp" "$meta_tmp" > "$outf"

    rm -f "$meta_tmp" "$acl_tmp" "$cksum_tmp"
}
export -f scan_chunk log elapsed_fmt

# ---------------------------------------------------------------------------
# scan_subdir_worker <subdir_name> <mount_root> <tmpdir> <label> <skip_cs>
# Wrapper called by the parallel worker pool inside scan_volume.
# ---------------------------------------------------------------------------
scan_subdir_worker() {
    local d="$1" mp="$2" tmpdir="$3" label="$4" skip_cs="$5"
    local safe
    safe=$(printf '%s' "$d" | tr '/ ' '__')
    local outf="$tmpdir/${safe}.raw"

    local t0
    t0=$(date +%s)
    scan_chunk "$mp/$d" "$d" "$outf" "$label" "$skip_cs"

    local cnt elapsed
    cnt=$(wc -l < "$outf")
    elapsed=$(elapsed_fmt "$t0")
    log "SCAN|$label" "  ✓  $d  ($cnt entries)  [${elapsed}]"
}
export -f scan_subdir_worker

# ---------------------------------------------------------------------------
# scan_volume <smb_share> <output_tsv> <label> <workers> <skip_cs>
# ---------------------------------------------------------------------------
scan_volume() {
    local share="$1"
    local out_file="$2"
    local label="$3"
    local workers="$4"
    local skip_cs="$5"

    local mp="/mnt/smb_cmp_${BASHPID}_$(date +%s%N)"
    local tmpdir cred_file
    tmpdir=$(mktemp -d)

    # Write credentials to a private temp file so the password never appears
    # in the process list or mount command output.
    cred_file=$(mktemp)
    chmod 600 "$cred_file"
    printf 'username=%s\npassword=%s\ndomain=%s\n' \
        "$SMB_USER" "$SMB_PASS" "$SMB_DOMAIN" > "$cred_file"

    trap '
        sudo umount "$mp" 2>/dev/null || sudo umount -l "$mp" 2>/dev/null || true
        sudo rmdir  "$mp" 2>/dev/null || true
        rm -rf "$tmpdir" "$cred_file"
    ' EXIT

    local vol_start
    vol_start=$(date +%s)

    log "INFO|$label" "Mounting $share → $mp"
    sudo mkdir -p "$mp"

    if ! mount_smb "$share" "$mp" "$label" "$cred_file"; then
        log "ERROR|$label" "All mount attempts failed for $share"
        exit 3
    fi

    # Probe getcifsacl support on the mount root so the operator is warned
    # early if ACL collection will silently return NO_ACL for all entries.
    if ! sudo getcifsacl "$mp" >/dev/null 2>&1; then
        log "WARN|$label" "getcifsacl returned an error on mount root – ACL fields may show NO_ACL"
        log "WARN|$label" "  Verify: cifs-utils >= 6.x installed; server exposes MS-DTYP ACLs"
    fi

    # Scan root-level entries (depth 1) in background while we list subdirs.
    local root_outf="$tmpdir/_root.raw"
    scan_chunk "$mp" "" "$root_outf" "$label" "$skip_cs" &
    local root_pid=$!

    log "INFO|$label" "Enumerating top-level directories..."
    local -a subdirs
    mapfile -t subdirs < <(
        sudo find "$mp" -maxdepth 1 -mindepth 1 -type d -printf '%P\n' | sort
    )

    local ndirs=${#subdirs[@]}
    log "INFO|$label" "$ndirs top-level dir(s) – scanning with $workers parallel workers"
    (( SKIP_CHECKSUM == 1 )) && log "INFO|$label" "Checksum: SKIPPED (--skip-checksum)"
    (( SKIP_CHECKSUM == 0 )) && log "INFO|$label" "Checksum: MD5 (pass --skip-checksum to disable)"

    # Worker pool – cap concurrency at $workers.
    local active=0
    for d in "${subdirs[@]}"; do
        scan_subdir_worker "$d" "$mp" "$tmpdir" "$label" "$skip_cs" &
        (( active++ )) || true
        if (( active >= workers )); then
            wait -n 2>/dev/null || wait
            (( active-- )) || true
        fi
    done
    wait "$root_pid" || true
    wait   # drain remaining subdir workers

    log "INFO|$label" "Merging and sorting $(ls "$tmpdir"/*.raw 2>/dev/null | wc -l) chunk(s)..."

    {
        printf 'path\ttype\tmtime_epoch\tatime_epoch\tacl\tchecksum\n'
        # shellcheck disable=SC2035
        cat "$tmpdir"/*.raw 2>/dev/null | sort -t$'\t' -k1,1
    } > "$out_file"

    local entry_count
    entry_count=$(( $(wc -l < "$out_file") - 1 ))
    log "INFO|$label" "$entry_count total entries → $out_file"
    log "INFO|$label" "Volume scan completed in $(elapsed_fmt "$vol_start")"

    trap - EXIT
    sudo umount "$mp" 2>/dev/null || sudo umount -l "$mp" 2>/dev/null || true
    sudo rmdir  "$mp" 2>/dev/null || true
    rm -rf "$tmpdir" "$cred_file"
}

# ---------------------------------------------------------------------------
# compare_metadata <src_tsv> <dst_tsv> <diff_tsv>
#
# Input TSV columns:
#   path  type  mtime_epoch  atime_epoch  acl  checksum
#
# Discrepancy TSV columns:
#   path  field  source_value  destination_value
#   src_acl  dst_acl  src_checksum  dst_checksum  checksum_match_status
#
# Fields compared: mtime, atime, acl, checksum (files only).
# ---------------------------------------------------------------------------
compare_metadata() {
    local src_file="$1" dst_file="$2" diff_file="$3"
    local cmp_start
    cmp_start=$(date +%s)

    printf 'path\tfield\tsource_value\tdestination_value\tsrc_acl\tdst_acl\tsrc_checksum\tdst_checksum\tchecksum_match_status\n' \
        > "$diff_file"

    local diff_count=0

    declare -A src_type src_mtime src_atime src_acl src_cksum
    declare -A dst_type dst_mtime dst_atime dst_acl dst_cksum

    while IFS=$'\t' read -r path type mtime atime acl cksum; do
        [[ -z "$path" ]] && continue
        src_type["$path"]="$type"
        src_mtime["$path"]="${mtime%%.*}"
        src_atime["$path"]="${atime%%.*}"
        src_acl["$path"]="$acl"
        src_cksum["$path"]="$cksum"
    done < <(tail -n +2 "$src_file")

    while IFS=$'\t' read -r path type mtime atime acl cksum; do
        [[ -z "$path" ]] && continue
        dst_type["$path"]="$type"
        dst_mtime["$path"]="${mtime%%.*}"
        dst_atime["$path"]="${atime%%.*}"
        dst_acl["$path"]="$acl"
        dst_cksum["$path"]="$cksum"
    done < <(tail -n +2 "$dst_file")

    declare -A all_paths
    for p in "${!src_type[@]}" "${!dst_type[@]}"; do all_paths["$p"]=1; done

    # record_diff <path> <field> <src_val> <dst_val>
    # Appends a full discrepancy row including ACL and checksum context columns.
    record_diff() {
        local p="$1" field="$2" sv="$3" dv="$4"
        local sa="${src_acl[$p]:-}"   da="${dst_acl[$p]:-}"
        local sc="${src_cksum[$p]:-}" dc="${dst_cksum[$p]:-}"
        local cs_status="N/A"
        if [[ "$sc" != "-" && "$sc" != "SKIPPED" && "$dc" != "-" && "$dc" != "SKIPPED" ]]; then
            [[ "$sc" == "$dc" ]] && cs_status="MATCH" || cs_status="MISMATCH"
        fi
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$p" "$field" "$sv" "$dv" "$sa" "$da" "$sc" "$dc" "$cs_status" \
            >> "$diff_file"
        (( diff_count++ )) || true
        log "ERROR" "MISMATCH  path=\"$p\"  field=$field  src=\"$sv\"  dst=\"$dv\"  cksum_status=$cs_status"
    }

    while IFS= read -r p; do
        [[ -z "$p" ]] && continue
        local in_src=${src_type["$p"]+yes}
        local in_dst=${dst_type["$p"]+yes}

        if [[ "${in_src:-}" != "yes" ]]; then
            record_diff "$p" "EXISTS_IN_DST_ONLY" "-" "yes"
            continue
        fi
        if [[ "${in_dst:-}" != "yes" ]]; then
            record_diff "$p" "EXISTS_IN_SRC_ONLY" "yes" "-"
            continue
        fi

        [[ "${src_mtime[$p]}" != "${dst_mtime[$p]}" ]] && \
            record_diff "$p" "mtime" "${src_mtime[$p]}" "${dst_mtime[$p]}"
        [[ "${src_atime[$p]}" != "${dst_atime[$p]}" ]] && \
            record_diff "$p" "atime" "${src_atime[$p]}" "${dst_atime[$p]}"
        [[ "${src_acl[$p]}"   != "${dst_acl[$p]}"   ]] && \
            record_diff "$p" "acl"   "${src_acl[$p]}"   "${dst_acl[$p]}"

        # Checksum: only compare regular files; skip dirs/symlinks and SKIPPED entries.
        local sc="${src_cksum[$p]:-}" dc="${dst_cksum[$p]:-}"
        if [[ "$sc" != "-" && "$sc" != "SKIPPED" && "$dc" != "-" && "$dc" != "SKIPPED" ]]; then
            [[ "$sc" != "$dc" ]] && record_diff "$p" "checksum" "$sc" "$dc"
        fi

    done < <(printf '%s\n' "${!all_paths[@]}" | sort)

    log "INFO" "Comparison completed in $(elapsed_fmt "$cmp_start")"

    if (( diff_count == 0 )); then
        log "OK" "All fields match. No discrepancies found."
        return 0
    fi

    log "ERROR" "$diff_count discrepanc(ies) found – report: $diff_file"
    return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
ensure_smb_client

log "INFO" "Source:          $SRC"
log "INFO" "Destination:     $DST"
log "INFO" "Windows host:    172.30.202.5"
log "INFO" "SMB User:        $SMB_USER"
log "INFO" "SMB Domain:      $SMB_DOMAIN"
log "INFO" "Workers:         $WORKERS"
log "INFO" "Skip checksum:   $( (( SKIP_CHECKSUM )) && echo yes || echo no )"
log "INFO" "---"
log "INFO" "Scanning source and destination in parallel..."

scan_volume "$SRC" "$SRC_OUT" "SRC" "$WORKERS" "$SKIP_CHECKSUM" &
SRC_PID=$!
scan_volume "$DST" "$DST_OUT" "DST" "$WORKERS" "$SKIP_CHECKSUM" &
DST_PID=$!

SRC_RC=0; DST_RC=0
wait "$SRC_PID" || SRC_RC=$?
wait "$DST_PID" || DST_RC=$?

(( SRC_RC != 0 )) && { log "ERROR" "Source scan failed (exit $SRC_RC)";      exit 3; }
(( DST_RC != 0 )) && { log "ERROR" "Destination scan failed (exit $DST_RC)"; exit 3; }

log "INFO" "---"
log "INFO" "Both scans complete. Comparing metadata..."

if compare_metadata "$SRC_OUT" "$DST_OUT" "$DIFF_OUT"; then
    log "INFO" "---"
    log "INFO" "Total time: $(elapsed_fmt "$SCRIPT_START")"
    exit 0
else
    log "INFO" "---"
    log "INFO" "Total time: $(elapsed_fmt "$SCRIPT_START")"
    exit 1
fi
