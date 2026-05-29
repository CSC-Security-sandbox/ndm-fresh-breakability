#!/usr/bin/env bash
# =============================================================================
# nfs_metadata_compare.sh
#
# Scans two NFS exports in parallel, records per-entry metadata to TSV files,
# compares them field-by-field, and exits non-zero on any discrepancy.
#
# Metadata collected per entry:
#   path  type  uid  gid  permissions  mtime_epoch  atime_epoch  checksum
#
# Discrepancy report columns:
#   path  field  source_value  destination_value
#   src_permissions  dst_permissions
#   src_checksum  dst_checksum  checksum_match_status
#
# Speed strategy:
#   1. Source and destination are scanned concurrently (background jobs).
#   2. Within each scan, top-level subdirectories are walked in parallel
#      (--workers, default 8) so multiple NFS stat streams run at once.
#   3. MD5 checksums are computed with xargs -P 4 inside each worker.
#
# Usage:
#   sudo ./nfs_metadata_compare.sh \
#       --src            172.30.202.20:/master_nfs_vol_dnd_src_automation_1 \
#       --dst            172.30.202.20:/master_nfs_vol_dnd_dst_automation_1 \
#       [--src-out       src_metadata.tsv]    \
#       [--dst-out       dst_metadata.tsv]    \
#       [--diff-out      discrepancies.tsv]   \
#       [--workers       8]                   \
#       [--skip-checksum]
#
# Exit codes:
#   0 – all fields match
#   1 – one or more discrepancies found
#   2 – usage / argument error
#   3 – NFS mount / scan error
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SRC=""
DST=""
SRC_OUT="src_metadata.tsv"
DST_OUT="dst_metadata.tsv"
DIFF_OUT="discrepancies.tsv"
WORKERS=8
SKIP_CHECKSUM=0
SKIP_ATIME=0

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
    echo "Usage: sudo $0 --src <nfs_export> --dst <nfs_export>"
    echo "             [--src-out       src_metadata.tsv]"
    echo "             [--dst-out       dst_metadata.tsv]"
    echo "             [--diff-out      discrepancies.tsv]"
    echo "             [--workers       8]"
    echo "             [--skip-checksum]   skip MD5 checksum (faster)"
    echo "             [--skip-atime]      skip atime comparison"
    exit 2
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --src)            SRC="$2";         shift 2 ;;
        --dst)            DST="$2";         shift 2 ;;
        --src-out)        SRC_OUT="$2";     shift 2 ;;
        --dst-out)        DST_OUT="$2";     shift 2 ;;
        --diff-out)       DIFF_OUT="$2";    shift 2 ;;
        --workers)        WORKERS="$2";     shift 2 ;;
        --skip-checksum)  SKIP_CHECKSUM=1;  shift   ;;
        --skip-atime)     SKIP_ATIME=1;     shift   ;;
        -h|--help)        usage ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$SRC" || -z "$DST" ]] && { echo "ERROR: --src and --dst are required"; usage; }

# ---------------------------------------------------------------------------
# Logging + timing helpers
# ---------------------------------------------------------------------------
# \r   – move cursor to column 0 (undo any stray carriage returns)
# \033[K – clear from cursor to end of line (wipe leftover characters)
# This keeps logs clean even when parallel background jobs share the same stderr.
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

# SCRIPT_START is recorded once at the very top so total elapsed works
SCRIPT_START=$(date +%s)

# ---------------------------------------------------------------------------
# Ensure nfs-common is installed
# ---------------------------------------------------------------------------
ensure_nfs_client() {
    if ! command -v mount.nfs >/dev/null 2>&1; then
        log "INFO" "mount.nfs not found – installing nfs-common..."
        sudo apt-get install -y nfs-common >/dev/null 2>&1
    fi
}

# ---------------------------------------------------------------------------
# mount_nfs <export> <mountpoint> <label>
# Tries ro, then vers=3, vers=4, vers=4.1 in order.
# ---------------------------------------------------------------------------
mount_nfs() {
    local export_path="$1" mp="$2" label="$3"
    # Each attempt is capped at 30 s so a hung NFS server doesn't block forever.
    for opts in "ro" "ro,vers=3" "ro,vers=4" "ro,vers=4.1"; do
        log "INFO|$label" "Trying mount -o $opts ..."
        if timeout 30 sudo mount -o "$opts" -t nfs "$export_path" "$mp" 2>/dev/null; then
            log "INFO|$label" "Mounted $export_path (opts: $opts)"
            return 0
        fi
        log "INFO|$label" "  → failed or timed out, trying next..."
    done
    return 1
}

# ---------------------------------------------------------------------------
# scan_chunk <find_start> <prefix> <outfile> <label> <skip_checksum>
#
# Scans one directory chunk (either a top-level subdir or the root):
#   1. find -printf  → metadata (path, type, uid, gid, permissions, mtime, atime)
#   2. md5sum        → checksum per regular file (or "-" if --skip-checksum)
#   3. awk join      → merged 8-column TSV chunk
#
# find -printf tokens:
#   %P  relative path from find start point
#   %y  type: f=file  d=directory  l=symlink
#   %U  numeric UID
#   %G  numeric GID
#   %m  permissions in octal (e.g. 755)
#   %s  size in bytes
#   %T@ mtime epoch (decimal, sub-second)
#   %A@ atime epoch (decimal, sub-second)
# ---------------------------------------------------------------------------
scan_chunk() {
    local find_start="$1"   # absolute path to scan from
    local prefix="$2"       # prepend to each relative path ("subdir" or "")
    local outf="$3"
    local label="$4"
    local skip_cs="$5"      # 1 = skip checksum

    local depth_opt
    # Root-level scan is maxdepth 1 only; subdir scans go fully recursive
    [[ "$prefix" == "" ]] && depth_opt="-maxdepth 1 -mindepth 1" || depth_opt="-mindepth 1"

    local meta_tmp="${outf}.meta"
    local cksum_tmp="${outf}.cksum"

    # Step 1: collect metadata via find -printf, sort by path
    # shellcheck disable=SC2086
    sudo find "$find_start" $depth_opt \
        -not -name '.snapshot' -not -path '*/.snapshot/*' \
        -printf '%P\t%y\t%U\t%G\t%m\t%s\t%T@\t%A@\n' \
    | sort -t$'\t' -k1,1 > "$meta_tmp"

    # Step 2: compute MD5 checksums for regular files
    if (( skip_cs == 0 )); then
        # shellcheck disable=SC2086
        sudo find "$find_start" $depth_opt -type f \
             -not -name '.snapshot' -not -path '*/.snapshot/*' -print0 2>/dev/null \
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
        # empty checksum file — awk join will fall back to "-"
        : > "$cksum_tmp"
    fi

    # Step 3: join metadata with checksums
    # cksum_tmp is read first  (ARGIND==1) → builds lookup table
    # meta_tmp  is read second (ARGIND==2) → each row is enriched
    #
    # NOTE: ARGIND (not NR==FNR) is used here because NR==FNR breaks when
    # cksum_tmp is empty (--skip-checksum): awk never advances NR past 0
    # for the empty file, so the entire meta_tmp is mistakenly treated as
    # the checksum file and all rows are swallowed silently.
    awk -v pfx="$prefix" -v skip="$skip_cs" -v OFS='\t' '
        ARGIND == 1 {
            cksum[$1] = $2
            next
        }
        {
            n = split($0, f, "\t")
            rel  = f[1]
            type = f[2]
            if (skip == 1) {
                c = "SKIPPED"
            } else {
                c = (type == "f") ? (rel in cksum ? cksum[rel] : "CHECKSUM_ERROR") : "-"
            }
            fp = (pfx != "") ? pfx "/" rel : rel
            # fields: path type uid gid permissions size_bytes mtime atime checksum
            # f[1]=path f[2]=type f[3]=uid f[4]=gid f[5]=perms f[6]=size f[7]=mtime f[8]=atime
            print fp, type, f[3], f[4], f[5], f[6], f[7], f[8], c
        }
    ' "$cksum_tmp" "$meta_tmp" > "$outf"

    rm -f "$meta_tmp" "$cksum_tmp"
}
export -f scan_chunk log

# ---------------------------------------------------------------------------
# scan_subdir_worker <subdir_name> <mount_root> <tmpdir> <label> <skip_cs>
# Wrapper called by the parallel worker pool.
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
# scan_volume <nfs_export> <output_tsv> <label> <workers> <skip_cs>
# ---------------------------------------------------------------------------
scan_volume() {
    local export_path="$1"
    local out_file="$2"
    local label="$3"
    local workers="$4"
    local skip_cs="$5"

    local mp="/mnt/nfs_cmp_${BASHPID}_$(date +%s%N)"
    local tmpdir
    tmpdir=$(mktemp -d)

    trap 'sudo umount "$mp" 2>/dev/null || sudo umount -l "$mp" 2>/dev/null || true
          sudo rmdir "$mp" 2>/dev/null || true
          rm -rf "$tmpdir"' EXIT

    local vol_start
    vol_start=$(date +%s)

    log "INFO|$label" "Mounting $export_path → $mp"
    sudo mkdir -p "$mp"

    if ! mount_nfs "$export_path" "$mp" "$label"; then
        log "ERROR|$label" "All mount attempts failed for $export_path"
        exit 3
    fi

    # Scan root-level entries (depth 1) in background while we list subdirs
    local root_outf="$tmpdir/_root.raw"
    scan_chunk "$mp" "" "$root_outf" "$label" "$skip_cs" &
    local root_pid=$!

    log "INFO|$label" "Enumerating top-level directories..."
    local -a subdirs
    mapfile -t subdirs < <(
        sudo find "$mp" -maxdepth 1 -mindepth 1 -type d \
            -not -path '*/.snapshot*' -printf '%P\n' | sort
    )

    local ndirs=${#subdirs[@]}
    log "INFO|$label" "$ndirs top-level dir(s) – scanning with $workers parallel workers"
    (( SKIP_CHECKSUM == 1 )) && log "INFO|$label" "Checksum: SKIPPED (--skip-checksum)"
    (( SKIP_CHECKSUM == 0 )) && log "INFO|$label" "Checksum: MD5 (pass --skip-checksum to disable)"

    # Worker pool
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
        printf 'path\ttype\tuid\tgid\tpermissions\tsize_bytes\tmtime_epoch\tatime_epoch\tchecksum\n'
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
    rm -rf "$tmpdir"
}

# ---------------------------------------------------------------------------
# compare_metadata <src_tsv> <dst_tsv> <diff_tsv>
#
# Discrepancy TSV columns:
#   path  field  source_value  destination_value
#   source_permissions  destination_permissions
#   source_checksum     destination_checksum
#   checksum_match_status
# ---------------------------------------------------------------------------
compare_metadata() {
    local src_file="$1" dst_file="$2" diff_file="$3"
    local cmp_start
    cmp_start=$(date +%s)

    printf 'path\tfield\tsource_value\tdestination_value\tsource_permissions\tdestination_permissions\tsource_checksum\tdestination_checksum\tchecksum_match_status\n' \
        > "$diff_file"

    local diff_count=0

    declare -A src_uid  src_gid  src_perms  src_size  src_mtime  src_atime  src_cksum  src_type
    declare -A dst_uid  dst_gid  dst_perms  dst_size  dst_mtime  dst_atime  dst_cksum  dst_type

    while IFS=$'\t' read -r path type uid gid perms size mtime atime cksum; do
        [[ -z "$path" ]] && continue
        src_type["$path"]="$type"
        src_uid["$path"]="$uid";   src_gid["$path"]="$gid"
        src_perms["$path"]="$perms"
        src_size["$path"]="$size"
        src_mtime["$path"]="${mtime%%.*}"
        src_atime["$path"]="${atime%%.*}"
        src_cksum["$path"]="$cksum"
    done < <(tail -n +2 "$src_file")

    while IFS=$'\t' read -r path type uid gid perms size mtime atime cksum; do
        [[ -z "$path" ]] && continue
        dst_type["$path"]="$type"
        dst_uid["$path"]="$uid";   dst_gid["$path"]="$gid"
        dst_perms["$path"]="$perms"
        dst_size["$path"]="$size"
        dst_mtime["$path"]="${mtime%%.*}"
        dst_atime["$path"]="${atime%%.*}"
        dst_cksum["$path"]="$cksum"
    done < <(tail -n +2 "$dst_file")

    declare -A all_paths
    for p in "${!src_uid[@]}" "${!dst_uid[@]}"; do all_paths["$p"]=1; done

    # record_diff <path> <field> <src_val> <dst_val>
    # Appends a full discrepancy row including permission and checksum context.
    record_diff() {
        local p="$1" field="$2" sv="$3" dv="$4"
        local sp="${src_perms[$p]:-}"   dp="${dst_perms[$p]:-}"
        local sc="${src_cksum[$p]:-}"   dc="${dst_cksum[$p]:-}"
        local cs_status="N/A"
        if [[ "$sc" != "-" && "$sc" != "SKIPPED" && "$dc" != "-" && "$dc" != "SKIPPED" ]]; then
            [[ "$sc" == "$dc" ]] && cs_status="MATCH" || cs_status="MISMATCH"
        fi
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$p" "$field" "$sv" "$dv" "$sp" "$dp" "$sc" "$dc" "$cs_status" \
            >> "$diff_file"
        (( diff_count++ )) || true
        log "ERROR" "MISMATCH  path=\"$p\"  field=$field  src=\"$sv\"  dst=\"$dv\"  cksum_status=$cs_status"
    }

    while IFS= read -r p; do
        [[ -z "$p" ]] && continue
        local in_src=${src_uid["$p"]+yes}
        local in_dst=${dst_uid["$p"]+yes}

        if [[ "${in_src:-}" != "yes" ]]; then
            record_diff "$p" "EXISTS_IN_DST_ONLY" "-" "yes"
            continue
        fi
        if [[ "${in_dst:-}" != "yes" ]]; then
            record_diff "$p" "EXISTS_IN_SRC_ONLY" "yes" "-"
            continue
        fi

        [[ "${src_uid[$p]}"   != "${dst_uid[$p]}"   ]] && record_diff "$p" "uid"         "${src_uid[$p]}"   "${dst_uid[$p]}"
        [[ "${src_gid[$p]}"   != "${dst_gid[$p]}"   ]] && record_diff "$p" "gid"         "${src_gid[$p]}"   "${dst_gid[$p]}"
        [[ "${src_perms[$p]}" != "${dst_perms[$p]}" ]] && record_diff "$p" "permissions" "${src_perms[$p]}" "${dst_perms[$p]}"
        [[ "${src_size[$p]}"  != "${dst_size[$p]}"  ]] && record_diff "$p" "size_bytes"  "${src_size[$p]}"  "${dst_size[$p]}"
        [[ "${src_mtime[$p]}" != "${dst_mtime[$p]}" ]] && record_diff "$p" "mtime"       "${src_mtime[$p]}" "${dst_mtime[$p]}"
        if (( SKIP_ATIME == 0 )); then
            [[ "${src_atime[$p]}" != "${dst_atime[$p]}" ]] && record_diff "$p" "atime" "${src_atime[$p]}" "${dst_atime[$p]}"
        fi

        # Checksum: only compare for regular files; skip dirs/symlinks and SKIPPED entries
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
ensure_nfs_client

log "INFO" "Source:          $SRC"
log "INFO" "Destination:     $DST"
log "INFO" "Workers:         $WORKERS"
log "INFO" "Skip checksum:   $( (( SKIP_CHECKSUM )) && echo yes || echo no )"
log "INFO" "Skip atime:      $( (( SKIP_ATIME ))     && echo yes || echo no )"
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
