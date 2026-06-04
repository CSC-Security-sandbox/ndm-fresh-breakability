"""Parquet schemas (SPEC §3, v0.3) + file-type codes + writer settings.

This module is pure data — no I/O. The schemas are the contract between the TS producer
(via the Redis stream) and every reader in this service (sort, merge, merkle, diff).
"""

from __future__ import annotations

import pyarrow as pa

MB = 1024 * 1024

# --- Writer settings (SPEC §3.4) — shared by every writer in the service ---
COMPRESSION = "zstd"
COMPRESSION_LEVEL = 3
DATA_PAGE_SIZE = 1 * MB
ROW_GROUP_TARGET_BYTES = 128 * MB
DICTIONARY_COLUMNS = ["file_type", "acl_hash", "mode", "uid", "gid"]

SCHEMA_VERSION = "1"
ACL_HASH_ALGO = "blake3-128"
PATH_NORMALIZE = "NFC"


# --- file_type single-char codes (D17 / SPEC §3.1) ---
# Stored value is the KEY (one char). Diff/merkle classify via FILE_TYPE_CLASS.
FILE_TYPE_CODES: dict[str, str] = {
    "F": "FILE",
    "D": "DIRECTORY",
    "L": "SYMBOLIC_LINK",
    "J": "JUNCTION",
    "H": "SHORTCUT",
    "M": "VOLUME_MOUNT_POINT",
    "S": "SOCKET",
    "P": "FIFO",
    "C": "CHARACTER_DEVICE",
    "B": "BLOCK_DEVICE",
    "T": "STREAM",  # NTFS Alternate Data Stream
    "U": "UNKNOWN",
}
TYPE_TO_CODE: dict[str, str] = {v: k for k, v in FILE_TYPE_CODES.items()}

DIR_CODE = "D"
SYMLINK_CODES = frozenset({"L", "J", "H", "M"})


def file_type_class(code: str) -> str:
    """Behaviour class used by the diff: 'dir' | 'symlink' | 'file'."""
    if code == DIR_CODE:
        return "dir"
    if code in SYMLINK_CODES:
        return "symlink"
    return "file"


# --- Raw scan rows (SPEC §3.1) — 12 columns; ✓ = feeds children dir-hash ---
RAW_SCHEMA = pa.schema(
    [
        pa.field("filepath", pa.string(), nullable=False),   # ✓ (basename), NFC
        pa.field("file_type", pa.string(), nullable=False),  # ✓ single-char code
        pa.field("file_size", pa.int64(), nullable=False),   # ✓
        pa.field("mtime", pa.int64(), nullable=False),       # ✓ epoch ns
        pa.field("mode", pa.int32(), nullable=False),        # ✓
        pa.field("uid", pa.int64(), nullable=False),         # ✓
        pa.field("gid", pa.int64(), nullable=False),         # ✓
        pa.field("acl_hash", pa.string(), nullable=True),    # ✓ SMB; owner SID folded in (computed on TS)
        pa.field("atime", pa.int64(), nullable=True),        # ✗ value-only
        pa.field("birthtime", pa.int64(), nullable=True),    # ✗ value-only
        pa.field("ctime", pa.int64(), nullable=True),        # ✗ value-only — NEVER hashed
        pa.field("inode_num", pa.int64(), nullable=True),    # ✗ value-only
    ]
)

# Columns that feed a row's contribution to its parent directory's hash (length-prefixed, in order).
HASH_COLUMNS = ["filepath", "file_type", "file_size", "mtime", "mode", "uid", "gid", "acl_hash"]
# Directory's own attribute columns copied into the merkle row (D12) — basis for dir `sm` detection.
DIR_ATTR_COLUMNS = ["file_type", "mode", "uid", "gid", "acl_hash", "mtime", "atime", "birthtime", "ctime", "inode_num"]


# --- Merkle / dir-summary rows (SPEC §3.2, D12/D13) ---
MERKLE_SCHEMA = pa.schema(
    [
        pa.field("dir_path", pa.string(), nullable=False),
        pa.field("dir_hash", pa.string(), nullable=False),   # BLAKE3-128 hex over CHILDREN; "" if empty (D13)
        # directory's OWN attributes (copied from its raw row) — for direct comparison & dir sm
        pa.field("file_type", pa.string(), nullable=False),  # always "D"
        pa.field("mode", pa.int32(), nullable=False),
        pa.field("uid", pa.int64(), nullable=False),
        pa.field("gid", pa.int64(), nullable=False),
        pa.field("acl_hash", pa.string(), nullable=True),
        pa.field("mtime", pa.int64(), nullable=True),
        pa.field("atime", pa.int64(), nullable=True),
        pa.field("birthtime", pa.int64(), nullable=True),
        pa.field("ctime", pa.int64(), nullable=True),
        pa.field("inode_num", pa.int64(), nullable=True),
        # aggregates
        pa.field("child_count", pa.int64(), nullable=False),
        pa.field("total_bytes", pa.int64(), nullable=False),
    ]
)


# --- Error rows (SPEC §3.3) — Phase 1 write-only ---
ERROR_SCHEMA = pa.schema(
    [
        pa.field("operation_id", pa.string()),
        pa.field("file_path", pa.string()),
        pa.field("file_name", pa.string()),
        pa.field("error_code", pa.string()),
        pa.field("error_message", pa.string()),
        pa.field("error_type", pa.string()),  # FATAL|TRANSIENT|RECOVERABLE|METADATA_UPDATE_CONFLICT
        pa.field("operation_name", pa.string()),
        pa.field("origin", pa.string()),
        pa.field("original_job_run_id", pa.string()),
        pa.field("op_kind", pa.string()),  # cc|sm|sa|cf|cd|rd|rf|cs
        pa.field("command_metadata", pa.string()),  # Cmd JSON for Phase-2 replay
        pa.field("ts", pa.int64()),
    ]
)


def build_kv_metadata(
    *,
    jobconfig_id: str,
    jobrun_id: str,
    writer_version: str,
    source_path_id: str | None = None,
    dest_path_id: str | None = None,
) -> dict[bytes, bytes]:
    """Footer KV metadata block (SPEC §3.4). Exactly one of source/dest path id is set."""
    kv: dict[bytes, bytes] = {
        b"schema_version": SCHEMA_VERSION.encode(),
        b"ndm_writer_version": writer_version.encode(),
        b"ndm_acl_hash_algo": ACL_HASH_ALGO.encode(),
        b"ndm_path_normalize": PATH_NORMALIZE.encode(),
        b"ndm_jobconfig_id": jobconfig_id.encode(),
        b"ndm_jobrun_id": jobrun_id.encode(),
    }
    if source_path_id is not None:
        kv[b"ndm_source_path_id"] = source_path_id.encode()
    if dest_path_id is not None:
        kv[b"ndm_dest_path_id"] = dest_path_id.encode()
    return kv
