"""Per-file sort (D8) + k-way external merge-sort (D11).

Sort key: full `filepath`, byte-order, NFC (normalization done on the TS producer, D10).

- sort_file(): each rotated raw Parquet (<=200 MB) fits in memory, so an in-memory sort is fine; we
  write the result to a SEPARATE *.sorted.parquet in the same folder (D8) — not in place.
- merge_sort(): k-way streaming merge of the sorted files (volumes are huge — does NOT fit in memory).
  fan-in 16, 2 GB working set, /tmp spill when level count exceeds fan-in. Reference: explore-parquet
  bench_merge.py / sort_bench.py.
"""

from __future__ import annotations

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .paths import atomic_parquet
from .schema import COMPRESSION, COMPRESSION_LEVEL, DATA_PAGE_SIZE

SORT_KEY = "filepath"


def sort_file(src: Path, dst: Path, schema: pa.Schema) -> None:
    """In-memory sort of one rotated raw Parquet by `filepath`; write a separate sorted file (D8)."""
    table = pq.read_table(str(src))
    table = table.sort_by([(SORT_KEY, "ascending")])
    with atomic_parquet(dst) as tmp:
        pq.write_table(
            table, str(tmp), schema=schema,
            compression=COMPRESSION, compression_level=COMPRESSION_LEVEL,
            data_page_size=DATA_PAGE_SIZE,
        )


def merge_sort(
    sorted_inputs: list[Path],
    out_path: Path,
    schema: pa.Schema,
    *,
    fan_in: int = 16,
    mem_budget_bytes: int = 2 * 1024**3,
    spill_dir: str = "/tmp",
) -> None:
    """k-way streaming merge of pre-sorted Parquet files into one globally sorted file.

    TODO (largest task, D2.6 / D11):
      1. Open each input with pq.ParquetFile(...).iter_batches() so no input is fully resident.
      2. heapq-merge the per-input row streams on `filepath` (byte order).
      3. If len(sorted_inputs) > fan_in, merge in levels: merge fan_in at a time into spill files in
         `spill_dir`, then merge the spill files (repeat) until one remains.
      4. Buffer output rows and write row groups (~128 MB target); keep resident set <= mem_budget_bytes.
      5. Emit heartbeat {bytes_consumed, bytes_remaining, current_merge_level} for the child workflow.
      6. Atomic seal via atomic_parquet(out_path); idempotent on output filename (restart re-reads raw/).
      7. De-dup on `filepath`, keeping the latest by Redis stream entry-id on ties (at-least-once, §6.2).
    """
    raise NotImplementedError("k-way external merge-sort — see SPEC §6 / D11 and explore-parquet/bench_merge.py")
