"""Directory-level Merkle hash builder (SPEC §3.2 / §6, D12/D13).

After the merge step, stream the globally-sorted merged Parquet and emit one MERKLE_SCHEMA row per
directory. The dir_hash is over the directory's CHILDREN ONLY (file rows' attribute bytes + subdir
dir_hashes); the directory's OWN attributes are copied into the row for the diff's direct comparison.

Algorithm (bottom-up, single pass over rows sorted by full path) — adapted from
explore-parquet/merkle_stream.py, with two changes:
  * directories are FIRST-CLASS rows (file_type == "D"), not inferred from file paths;
  * BLAKE3-128 (16-byte / 32-hex), not sha256.

Properties:
  * children sorted by basename (byte order, NFC); leaf dirs hashed first.
  * empty directory -> dir_hash == "" (D13); its own attributes are still emitted for comparison.
  * a file child contributes length-prefixed bytes of HASH_COLUMNS; a subdir child contributes its
    already-finalized dir_hash.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import blake3

from .schema import HASH_COLUMNS


@dataclass
class RootHash:
    dir_path: str
    dir_hash: str
    n_dirs: int


def blake3_128_hex(data: bytes) -> str:
    """BLAKE3 truncated to 128 bits (16 bytes), hex-encoded (SPEC Q5.2)."""
    return blake3.blake3(data).digest(length=16).hex()


def row_attr_bytes(row: dict) -> bytes:
    """Length-prefixed concat of HASH_COLUMNS for a file child (fixed order, SPEC §3.1)."""
    parts: list[bytes] = []
    for col in HASH_COLUMNS:
        v = row.get(col)
        b = b"" if v is None else (v.encode() if isinstance(v, str) else str(v).encode())
        parts.append(len(b).to_bytes(4, "little"))
        parts.append(b)
    return b"".join(parts)


def combine_children(children: list[tuple[str, bytes | str]]) -> str:
    """children: list of (basename, contribution) where contribution is row_attr_bytes (file)
    or the child dir_hash hex (subdir). Sorted by basename. Empty -> "" (D13)."""
    if not children:
        return ""
    h = blake3.blake3()
    for name, contrib in sorted(children, key=lambda c: c[0]):
        h.update(name.encode())
        h.update(contrib.encode() if isinstance(contrib, str) else contrib)
    return h.digest(length=16).hex()


class MerkleBuilder:
    def build(self, merged_path: Path, out_path: Path) -> RootHash:
        """Stream `merged_path` (sorted) -> write MERKLE_SCHEMA rows to `out_path`. Returns root.

        TODO (D3.1, novel algorithm — commit fixture trees with expected hashes as a regression suite):
          * pq.ParquetFile(merged_path).iter_batches() — never hold the whole table.
          * maintain a stack of open directories keyed by dir_path; a "D" row opens/annotates a dir with
            its own attributes; "F"/symlink rows attach as children of their parent dir.
          * when the cursor leaves a directory subtree, finalize it: dir_hash = combine_children(...),
            bubble (basename, dir_hash) up to the parent's child list, write its MERKLE row (dir_hash +
            copied own-attrs + child_count + total_bytes).
          * empty dir -> dir_hash == "".
          * write rows via atomic_parquet(out_path) using MERKLE_SCHEMA + KV metadata.
        """
        raise NotImplementedError("bottom-up merkle build — see explore-parquet/merkle_stream.py + SPEC §3.2")
