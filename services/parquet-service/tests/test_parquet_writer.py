"""ParquetWriter: atomic seal, ack-after-seal callback, no .tmp left behind."""

from __future__ import annotations

import pyarrow.parquet as pq

from parquet_service.lib.parquet_writer import ParquetWriter, SealInfo
from parquet_service.lib.schema import RAW_SCHEMA


def _row(i: int) -> dict:
    return {
        "filepath": f"/d/f{i}", "file_type": "F", "file_size": i, "mtime": i,
        "mode": 420, "uid": 1000, "gid": 1000, "acl_hash": None,
        "atime": None, "birthtime": None, "ctime": None, "inode_num": None,
    }


def test_writer_seals_atomically_and_acks_after_seal(tmp_path):
    sealed: list[SealInfo] = []
    w = ParquetWriter(
        tmp_path, lambda n: f"jr-src-0-{n}.parquet", RAW_SCHEMA,
        rotate_bytes=10 * 1024 * 1024, on_seal=sealed.append, flush_rows=100,
    )
    for i in range(250):
        w.append(_row(i), entry_id=f"0-{i}")
    w.close()

    # exactly one sealed file, all 250 entry-ids reported for ack, no .tmp orphan
    assert len(sealed) == 1
    assert sealed[0].rows == 250
    assert len(sealed[0].entry_ids) == 250
    assert sealed[0].path.exists()
    assert list(tmp_path.glob("*.tmp")) == []

    table = pq.read_table(str(sealed[0].path))
    assert table.num_rows == 250
    assert table.schema.names == RAW_SCHEMA.names
