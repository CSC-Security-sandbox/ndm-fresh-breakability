"""Rotating Parquet writer with atomic seal + ack-after-seal callback (SPEC §5.3, D7).

Rotation cap is 200 MB POST-compression. We can only know the compressed size after a row group is
flushed, so rotation is checked at row-group boundaries against the on-disk size of the open .tmp file.

Each appended row carries the Redis stream entry-id that produced it; on seal, `on_seal(SealInfo)` fires
with the list of entry-ids in that file so the caller can XACK them — and ONLY then (D7).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .paths import promote_atomically
from .schema import (
    COMPRESSION,
    COMPRESSION_LEVEL,
    DATA_PAGE_SIZE,
    DICTIONARY_COLUMNS,
)


@dataclass
class SealInfo:
    path: Path
    entry_ids: list[str]
    rows: int


@dataclass
class _Open:
    path: Path
    writer: pq.ParquetWriter
    tmp: Path
    entry_ids: list[str] = field(default_factory=list)
    rows: int = 0


class ParquetWriter:
    """Append rows; rotate at `rotate_bytes` post-compression; seal atomically.

    name_fn(n) -> filename for the n-th rotation (e.g. f"{run}-src-{ts}-{n}.parquet").
    """

    def __init__(
        self,
        out_dir: Path,
        name_fn: Callable[[int], str],
        schema: pa.Schema,
        *,
        rotate_bytes: int,
        kv_metadata: dict[bytes, bytes] | None = None,
        on_seal: Callable[[SealInfo], None] | None = None,
        flush_rows: int = 50_000,
    ) -> None:
        self._out = out_dir
        self._name_fn = name_fn
        self._schema = schema.with_metadata(kv_metadata) if kv_metadata else schema
        self._rotate_bytes = rotate_bytes
        self._on_seal = on_seal
        self._flush_rows = flush_rows
        self._n = 0
        self._buf: list[dict] = []
        self._buf_ids: list[str] = []
        self._cur: _Open | None = None

    # --- public API ---
    def append(self, row: dict, entry_id: str) -> None:
        self._buf.append(row)
        self._buf_ids.append(entry_id)
        if len(self._buf) >= self._flush_rows:
            self._flush_buffer()
            if self._cur and self._tmp_size() >= self._rotate_bytes:
                self._seal()

    def close(self) -> None:
        """Flush + seal the final file. Call exactly once at end-of-stream / pause-seal."""
        self._flush_buffer()
        if self._cur is not None:
            self._seal()

    # --- internals ---
    def _ensure_open(self) -> _Open:
        if self._cur is None:
            self._out.mkdir(parents=True, exist_ok=True)
            final = self._out / self._name_fn(self._n)
            tmp = final.with_suffix(final.suffix + ".tmp")
            writer = pq.ParquetWriter(
                str(tmp),
                self._schema,
                compression=COMPRESSION,
                compression_level=COMPRESSION_LEVEL,
                data_page_size=DATA_PAGE_SIZE,
                use_dictionary=DICTIONARY_COLUMNS,
            )
            self._cur = _Open(path=final, writer=writer, tmp=tmp)
        return self._cur

    def _flush_buffer(self) -> None:
        if not self._buf:
            return
        cur = self._ensure_open()
        table = pa.Table.from_pylist(self._buf, schema=self._schema)
        cur.writer.write_table(table)
        cur.rows += len(self._buf)
        cur.entry_ids.extend(self._buf_ids)
        self._buf.clear()
        self._buf_ids.clear()

    def _tmp_size(self) -> int:
        # Footer is only written on close(); this under-counts slightly but is fine for the cap check.
        try:
            return self._cur.tmp.stat().st_size if self._cur else 0
        except FileNotFoundError:
            return 0

    def _seal(self) -> None:
        """Close writer -> validate footer -> atomic rename -> fsync(dir) -> fire on_seal (D7/§13.3)."""
        cur = self._cur
        assert cur is not None
        cur.writer.close()                       # footer flushed into cur.tmp
        promote_atomically(cur.tmp, cur.path)    # validate footer -> atomic rename -> fsync(dir) (D7)
        if self._on_seal:                        # ack-after-seal: caller XACKs only now
            self._on_seal(SealInfo(path=cur.path, entry_ids=list(cur.entry_ids), rows=cur.rows))
        self._n += 1
        self._cur = None
