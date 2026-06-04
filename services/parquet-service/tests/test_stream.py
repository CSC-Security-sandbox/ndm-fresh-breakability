"""StreamReader / StreamWriter / CheckpointStore against fakeredis."""

from __future__ import annotations

import base64

import msgpack

from parquet_service.io.checkpoint import CheckpointStore
from parquet_service.io.stream_reader import StreamReader
from parquet_service.io.stream_writer import StreamWriter
from parquet_service.lib.command import Cmd


def _xadd_payload(client, key, payload: dict):
    obj = base64.b64encode(msgpack.packb(payload, use_bin_type=True)).decode()
    client.xadd(key, {"obj": obj})


def test_stream_reader_decodes_and_detects_eof(fake_redis):
    reader = StreamReader(fake_redis, "jr1", "sp1", "filemeta")
    reader.ensure_group()
    _xadd_payload(fake_redis, reader.stream_key, {"filepath": "/a", "file_type": "F"})
    fake_redis.xadd(reader.stream_key, {"eof": "1"})

    entries = reader.consume("c1", count=10, block_ms=10)
    assert len(entries) == 2
    payload = reader.decode(entries[0][1])
    assert payload["filepath"] == "/a"
    assert reader.is_eof(entries[1][1]) is True
    assert reader.ack([entries[0][0]]) == 1


def test_stream_writer_push_and_bulk(fake_redis):
    w = StreamWriter(fake_redis, "jr1")
    cmd = Cmd(id="c1", fPath="/a", status="PENDING", isDir=False, ops={"cf": {}})
    sid = w.push(cmd)
    assert sid
    ids = w.push_bulk([cmd, cmd])
    assert len(ids) == 2
    assert fake_redis.xlen("jr1:commands") == 3


def test_checkpoint_roundtrip(fake_redis):
    cp = CheckpointStore(fake_redis, "jr1", "sp1")
    assert cp.load() is None
    cp.save("/a/b")
    assert cp.load() == "/a/b"
    cp.clear()
    assert cp.load() is None
