#!/usr/bin/env bash
# =============================================================================
# nfs_churn.sh  –  Continuous source-churn script for NFS volumes (Linux)
#
# MODE 1 – RANDOM (default)
#   Picks random files/dirs each tick, runs a random batch of operations,
#   then sleeps --interval seconds.
#
# MODE 2 – FOCUSED  (--target-files "file1,file2,...")
#   Spawns one background worker per target file.  Each worker hammers its
#   file with mtime changes as fast as possible – no sleep, no delay.
#   Use this to stress-test retry logic / conflict detection.
#
# Operations (random mode):
#   TOUCH_MTIME    – change mtime only (atime preserved)
#   CHANGE_UID_GID – change owner uid:gid
#   CREATE_FILE    – create a new file with random content
#   DELETE_FILE    – delete a random file
#   CREATE_DIR     – create a new directory with 1-3 files inside
#   DELETE_DIR     – delete a script-created directory + its contents
#   APPEND_DATA    – append random bytes to an existing file
#
# Every operation is logged as a JSON line to the log file.
#
# Usage (random mode):
#   sudo ./nfs.sh --mount /mnt/src_vol --log /tmp/nfs_churn.log
#   sudo ./nfs.sh --mount /mnt/src_vol --log /tmp/nfs_churn.log \
#       --duration 600 --interval 2 --uids "1001,1002" --gids "2001,2002" \
#       --batch-min 5 --batch-max 20
#
# Usage (focused mode – no delay, parallel per-file workers):
#   sudo ./nfs.sh --mount /mnt/src_vol --log /tmp/nfs_churn.log \
#       --target-files "/mnt/src_vol/a.txt,/mnt/src_vol/b.txt"
#
# Requirements:
#   - Linux with bash 4+ and GNU coreutils (the default on every modern distro)
#   - Run as root (needed for chown)
#   - Tools used: find, touch, chown, dd, rm, date
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MOUNT=""
LOG=""
DURATION=0          # 0 = run forever
INTERVAL=2          # seconds between batch ticks (random mode only)
UIDS="1001,1002,1003"
GIDS="2001,2002,2003"
BATCH_MIN=1         # min operations per tick (random mode only)
BATCH_MAX=20        # max operations per tick (random mode only)
TARGET_FILES=""     # comma-separated absolute paths → activates focused mode

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
usage() {
    echo "Usage: sudo $0 --mount <path> --log <file>"
    echo "       [--duration N] [--interval N] [--uids a,b] [--gids a,b]"
    echo "       [--batch-min N] [--batch-max N]"
    echo "       [--target-files \"/abs/path/file1,/abs/path/file2\"]"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mount)        MOUNT="$2";        shift 2 ;;
        --log)          LOG="$2";          shift 2 ;;
        --duration)     DURATION="$2";     shift 2 ;;
        --interval)     INTERVAL="$2";     shift 2 ;;
        --uids)         UIDS="$2";         shift 2 ;;
        --gids)         GIDS="$2";         shift 2 ;;
        --batch-min)    BATCH_MIN="$2";    shift 2 ;;
        --batch-max)    BATCH_MAX="$2";    shift 2 ;;
        --target-files) TARGET_FILES="$2"; shift 2 ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$MOUNT" || -z "$LOG" ]] && usage
[[ ! -d "$MOUNT" ]] && { echo "ERROR: '$MOUNT' is not a directory"; exit 1; }

# Ensure log directory exists
mkdir -p "$(dirname "$LOG")"
LOG_LOCK="${LOG}.lock"

# ---------------------------------------------------------------------------
# Logging  – one JSON object per line
# flock ensures concurrent focused-mode subshells never interleave lines.
# ---------------------------------------------------------------------------
log_op() {
    local op="$1" path="$2" detail="$3"
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local line="{\"ts\":\"$ts\",\"op\":\"$op\",\"path\":\"$path\",\"detail\":$detail}"
    ( flock -x 200; echo "$line" >> "$LOG" ) 200>"$LOG_LOCK"
    printf "%-18s  %-40s  %s\n" "$op" "$path" "$detail" >&2
}

log_error() {
    local op="$1" path="$2" err="$3"
    local ts
    ts=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    local line="{\"ts\":\"$ts\",\"op\":\"$op\",\"path\":\"$path\",\"error\":\"$err\"}"
    ( flock -x 200; echo "$line" >> "$LOG" ) 200>"$LOG_LOCK"
    echo "ERROR  $op  $path  $err" >&2
}

# ---------------------------------------------------------------------------
# Build in-memory arrays from a single walk at startup
# dirs[]  – fixed (no dir create/delete)
# files[] – live (updated on create/delete)
# ---------------------------------------------------------------------------
declare -a dirs=()
declare -a files=()

build_state() {
    # timeout caps slow NFS scans; partial results are fine for churn
    mapfile -d '' dirs  < <(timeout 30s find "$MOUNT" -mindepth 1 -type d -print0 2>/dev/null || true)
    mapfile -d '' files < <(timeout 30s find "$MOUNT" -mindepth 1 -type f -print0 2>/dev/null || true)
    echo "[scan] ${#dirs[@]} dirs, ${#files[@]} files under $MOUNT" >&2
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

pick_random_dir() {
    (( ${#dirs[@]} == 0 )) && echo "$MOUNT" && return
    local idx=$(( RANDOM % ${#dirs[@]} ))
    echo "${dirs[$idx]}"
}

pick_random_entry() {
    # all entries: dirs + files
    local total=$(( ${#dirs[@]} + ${#files[@]} ))
    (( total == 0 )) && return 1
    local idx=$(( RANDOM % total ))
    if (( idx < ${#dirs[@]} )); then
        echo "${dirs[$idx]}"
    else
        echo "${files[$idx - ${#dirs[@]}]}"
    fi
}

pick_from_csv() {
    # Pick a random element from a comma-separated string (portable, no shuf)
    local csv="$1"
    local IFS=','
    local -a arr
    read -ra arr <<< "$csv"
    echo "${arr[$((RANDOM % ${#arr[@]}))]}"
}

relative_path() {
    local p="$1"
    echo "${p#$MOUNT/}"
}

random_offset_secs() {
    # Always under 60 s; 50% in 1-29 s, 50% in 30-59 s; random sign
    local mag sign
    if (( RANDOM % 2 == 0 )); then
        mag=$(( (RANDOM % 29) + 1 ))    # 1–29 s
    else
        mag=$(( (RANDOM % 30) + 30 ))   # 30–59 s
    fi
    if (( RANDOM % 2 == 0 )); then sign=1; else sign=-1; fi
    echo $(( mag * sign ))
}

# Format an epoch-seconds value as YYYYMMDDHHMM.SS for `touch -t` (GNU date).
epoch_to_touch_ts() {
    date -u -d "@$1" +"%Y%m%d%H%M.%S"
}

# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

op_touch_mtime() {
    (( ${#dirs[@]} + ${#files[@]} == 0 )) && return
    local target rel
    target=$(pick_random_entry) || return
    rel=$(relative_path "$target")

    local offset now_epoch new_mtime ts_for_touch
    offset=$(random_offset_secs)
    now_epoch=$(date -u +%s)
    new_mtime=$(( now_epoch + offset ))
    ts_for_touch=$(epoch_to_touch_ts "$new_mtime")

    # touch -m: only modify mtime (atime is preserved automatically)
    # touch -h: do not dereference symlinks (portable: works on GNU & BSD touch)
    if touch -m -h -t "$ts_for_touch" "$target" 2>/dev/null; then
        log_op "TOUCH_MTIME" "$rel" "{\"mtime\":$new_mtime,\"offset_s\":$offset}"
    else
        log_error "TOUCH_MTIME" "$rel" "touch failed"
    fi
}

op_change_uid_gid() {
    (( ${#dirs[@]} + ${#files[@]} == 0 )) && return
    local target rel
    target=$(pick_random_entry) || return
    rel=$(relative_path "$target")

    local uid gid
    uid=$(pick_from_csv "$UIDS")
    gid=$(pick_from_csv "$GIDS")

    if chown -h "${uid}:${gid}" "$target" 2>/dev/null; then
        log_op "CHANGE_UID_GID" "$rel" "{\"uid\":$uid,\"gid\":$gid}"
    else
        log_error "CHANGE_UID_GID" "$rel" "chown failed (need root?)"
    fi
}

op_create_file() {
    local parent
    parent=$(pick_random_dir)

    local fname="churn_$(printf '%06d' "$FILE_COUNTER")_${RANDOM}.txt"
    local fpath="$parent/$fname"
    local size=$(( (RANDOM % 4096) + 1 ))   # 1–4096 bytes

    if dd if=/dev/urandom of="$fpath" bs="$size" count=1 2>/dev/null; then
        (( FILE_COUNTER++ )) || true
        files+=("$fpath")
        log_op "CREATE_FILE" "$(relative_path "$fpath")" "{\"size_bytes\":$size}"
    else
        log_error "CREATE_FILE" "$(relative_path "$fpath")" "write failed"
    fi
}

op_delete_file() {
    (( ${#files[@]} <= 5 )) && return

    local idx=$(( RANDOM % ${#files[@]} ))
    local target="${files[$idx]}"
    local rel
    rel=$(relative_path "$target")

    if rm -f "$target"; then
        files=("${files[@]:0:$idx}" "${files[@]:$((idx+1))}")
        log_op "DELETE_FILE" "$rel" "{}"
    else
        log_error "DELETE_FILE" "$rel" "rm failed"
    fi
}

op_create_dir() {
    local parent
    parent=$(pick_random_dir)

    local dname="churn_dir_$(printf '%06d' "$DIR_COUNTER")_${RANDOM}"
    local dpath="$parent/$dname"

    if mkdir -p "$dpath" 2>/dev/null; then
        (( DIR_COUNTER++ )) || true
        dirs+=("$dpath")
        local rel
        rel=$(relative_path "$dpath")
        log_op "CREATE_DIR" "$rel" "{}"

        local file_count=$(( (RANDOM % 3) + 1 ))
        for (( fc = 0; fc < file_count; fc++ )); do
            local fname="churn_$(printf '%06d' "$FILE_COUNTER")_${RANDOM}.txt"
            local fpath="$dpath/$fname"
            local size=$(( (RANDOM % 4096) + 1 ))
            if dd if=/dev/urandom of="$fpath" bs="$size" count=1 2>/dev/null; then
                (( FILE_COUNTER++ )) || true
                files+=("$fpath")
                log_op "CREATE_FILE" "$(relative_path "$fpath")" "{\"size_bytes\":$size,\"in_new_dir\":true}"
            fi
        done
    else
        log_error "CREATE_DIR" "$(relative_path "$dpath")" "mkdir failed"
    fi
}

op_delete_dir() {
    (( ${#dirs[@]} <= 3 )) && return

    local attempts=0
    while (( attempts < 10 )); do
        (( attempts++ ))
        local idx=$(( RANDOM % ${#dirs[@]} ))
        local target="${dirs[$idx]}"

        # Only delete directories created by this script
        [[ "$(basename "$target")" != churn_dir_* ]] && continue
        [[ "$target" == "$MOUNT" ]] && continue

        local rel
        rel=$(relative_path "$target")

        if rm -rf "$target" 2>/dev/null; then
            dirs=("${dirs[@]:0:$idx}" "${dirs[@]:$((idx+1))}")
            local -a new_files=()
            for f in "${files[@]}"; do
                [[ "$f" != "$target"/* ]] && new_files+=("$f")
            done
            files=("${new_files[@]}")
            log_op "DELETE_DIR" "$rel" "{}"
            return
        else
            log_error "DELETE_DIR" "$rel" "rm -rf failed"
            return
        fi
    done
}

op_append_data() {
    (( ${#files[@]} == 0 )) && return

    local idx=$(( RANDOM % ${#files[@]} ))
    local target="${files[$idx]}"
    [[ ! -f "$target" ]] && return

    local rel
    rel=$(relative_path "$target")
    local append_size=$(( (RANDOM % 1024) + 1 ))   # 1-1024 bytes

    if dd if=/dev/urandom bs="$append_size" count=1 2>/dev/null >> "$target"; then
        log_op "APPEND_DATA" "$rel" "{\"appended_bytes\":$append_size}"
    else
        log_error "APPEND_DATA" "$rel" "append failed"
    fi
}

# ---------------------------------------------------------------------------
# Weighted operation picker
# Weights: TOUCH_MTIME=2, CHANGE_UID_GID=2, CREATE_FILE=2, DELETE_FILE=1,
#          CREATE_DIR=2, DELETE_DIR=1, APPEND_DATA=2  (sum = 12)
# ---------------------------------------------------------------------------
pick_op() {
    local r=$(( RANDOM % 12 ))
    if   (( r < 2 )); then echo "op_touch_mtime"
    elif (( r < 4 )); then echo "op_change_uid_gid"
    elif (( r < 6 )); then echo "op_create_file"
    elif (( r < 7 )); then echo "op_delete_file"
    elif (( r < 9 )); then echo "op_create_dir"
    elif (( r < 10 )); then echo "op_delete_dir"
    else                    echo "op_append_data"
    fi
}

# ---------------------------------------------------------------------------
# FOCUSED MODE – per-file worker (runs in a subshell, no sleep)
# ---------------------------------------------------------------------------
# Each worker loops forever (or until DURATION) touching mtime of its one file
# as fast as possible, logging every change.
focused_worker() {
    local fpath="$1"
    local rel
    rel="${fpath#$MOUNT/}"
    local start_epoch
    start_epoch=$(date -u +%s)

    while true; do
        if (( DURATION > 0 )); then
            local now
            now=$(date -u +%s)
            (( now - start_epoch >= DURATION )) && break
        fi

        local offset now_epoch new_mtime ts_for_touch
        offset=$(random_offset_secs)
        now_epoch=$(date -u +%s)
        new_mtime=$(( now_epoch + offset ))
        ts_for_touch=$(epoch_to_touch_ts "$new_mtime")

        if touch -m -h -t "$ts_for_touch" "$fpath" 2>/dev/null; then
            log_op "TOUCH_MTIME" "$rel" "{\"mtime\":$new_mtime,\"offset_s\":$offset,\"mode\":\"focused\"}"
        else
            log_error "TOUCH_MTIME" "$rel" "touch failed"
        fi
        # no sleep – hammer as fast as possible
    done
}

# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------
RUNNING=1
trap 'RUNNING=0; echo "" >&2; echo "Churn script stopping..." >&2' INT TERM

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
FILE_COUNTER=0
DIR_COUNTER=0

DURATION_DISPLAY="$DURATION"
(( DURATION == 0 )) && DURATION_DISPLAY="\"unlimited\""

# ── FOCUSED MODE ────────────────────────────────────────────────────────────
if [[ -n "$TARGET_FILES" ]]; then
    # Parse comma-separated file list
    IFS=',' read -ra TARGET_ARRAY <<< "$TARGET_FILES"

    # Validate every target exists
    for f in "${TARGET_ARRAY[@]}"; do
        [[ ! -f "$f" ]] && { echo "ERROR: target file '$f' does not exist"; exit 1; }
    done

    log_op "SCRIPT_START" "$MOUNT" \
        "{\"mode\":\"focused\",\"target_files\":\"$TARGET_FILES\",\"duration_s\":$DURATION_DISPLAY,\"workers\":${#TARGET_ARRAY[@]}}"

    echo "NFS churn (FOCUSED) – ${#TARGET_ARRAY[@]} parallel worker(s), no delay  (log → $LOG)" >&2
    for f in "${TARGET_ARRAY[@]}"; do
        echo "  worker: $f" >&2
    done

    START_TIME=$(date -u +%s)
    WORKER_PIDS=()

    # Export functions and variables needed by subshells
    export MOUNT LOG LOG_LOCK DURATION
    export -f focused_worker log_op log_error random_offset_secs epoch_to_touch_ts

    for f in "${TARGET_ARRAY[@]}"; do
        focused_worker "$f" &
        WORKER_PIDS+=($!)
    done

    # Wait; on INT/TERM kill all workers then exit cleanly
    trap 'RUNNING=0; kill "${WORKER_PIDS[@]}" 2>/dev/null; echo "" >&2; echo "Churn script stopping..." >&2' INT TERM

    wait "${WORKER_PIDS[@]}" 2>/dev/null || true

    ELAPSED=$(( $(date -u +%s) - START_TIME ))
    log_op "SCRIPT_STOP" "$MOUNT" "{\"mode\":\"focused\",\"elapsed_s\":$ELAPSED}"
    echo "NFS churn finished." >&2
    exit 0
fi

# ── RANDOM MODE ─────────────────────────────────────────────────────────────
build_state

DIR_COUNT=${#dirs[@]}
FILE_COUNT=${#files[@]}

log_op "SCRIPT_START" "$MOUNT" \
    "{\"mode\":\"random\",\"uids\":\"$UIDS\",\"gids\":\"$GIDS\",\"interval_s\":$INTERVAL,\"batch_min\":$BATCH_MIN,\"batch_max\":$BATCH_MAX,\"duration_s\":$DURATION_DISPLAY,\"dirs_found\":$DIR_COUNT,\"files_found\":$FILE_COUNT}"

echo "NFS churn (RANDOM) started on $MOUNT  (log → $LOG)" >&2

START_TIME=$(date -u +%s)

while (( RUNNING == 1 )); do
    if (( DURATION > 0 )); then
        NOW=$(date -u +%s)
        (( NOW - START_TIME >= DURATION )) && break
    fi

    # Pick a random batch size between BATCH_MIN and BATCH_MAX (inclusive)
    RANGE=$(( BATCH_MAX - BATCH_MIN + 1 ))
    BATCH_SIZE=$(( (RANDOM % RANGE) + BATCH_MIN ))

    for (( i = 0; i < BATCH_SIZE; i++ )); do
        OP=$(pick_op)
        $OP || true   # errors logged inside each op; never abort the loop
    done

    sleep "$INTERVAL"
done

ELAPSED=$(( $(date -u +%s) - START_TIME ))
log_op "SCRIPT_STOP" "$MOUNT" "{\"mode\":\"random\",\"files_created\":$FILE_COUNTER,\"dirs_created\":$DIR_COUNTER,\"elapsed_s\":$ELAPSED}"
echo "NFS churn finished." >&2
