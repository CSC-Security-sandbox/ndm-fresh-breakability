"""Schema + command-encoding contract tests."""

from __future__ import annotations

import base64

import msgpack

from parquet_service.lib import schema
from parquet_service.lib.command import Cmd, CmdMeta, OpsCmd


def test_raw_schema_shape():
    assert schema.RAW_SCHEMA.names == [
        "filepath", "file_type", "file_size", "mtime", "mode", "uid", "gid",
        "acl_hash", "atime", "birthtime", "ctime", "inode_num",
    ]
    # only filepath/file_type/size/mtime/mode/uid/gid are NOT NULL
    assert schema.RAW_SCHEMA.field("filepath").nullable is False
    assert schema.RAW_SCHEMA.field("acl_hash").nullable is True
    assert schema.RAW_SCHEMA.field("ctime").nullable is True


def test_merkle_schema_has_dir_attrs_and_hash():
    names = set(schema.MERKLE_SCHEMA.names)
    assert {"dir_path", "dir_hash", "child_count", "total_bytes"} <= names
    # dir's own attributes copied in (D12)
    assert {"mode", "uid", "gid", "acl_hash", "mtime"} <= names


def test_file_type_codes_roundtrip_and_class():
    assert schema.FILE_TYPE_CODES["D"] == "DIRECTORY"
    assert schema.TYPE_TO_CODE["SYMBOLIC_LINK"] == "L"
    assert schema.file_type_class("D") == "dir"
    assert schema.file_type_class("J") == "symlink"   # junction -> symlink-like
    assert schema.file_type_class("F") == "file"
    assert schema.file_type_class("S") == "file"       # socket -> file-like


def test_kv_metadata_mutually_exclusive_path_ids():
    kv = schema.build_kv_metadata(
        jobconfig_id="jc", jobrun_id="jr", writer_version="0.1.0", source_path_id="sp"
    )
    assert kv[b"ndm_source_path_id"] == b"sp"
    assert b"ndm_dest_path_id" not in kv


def test_cmd_wire_roundtrip():
    cmd = Cmd(
        id="c1", fPath="/a/b.txt", status="PENDING", isDir=False,
        ops={OpsCmd.CF.value: {}}, metadata=CmdMeta(size=10, mtime=1, ctime=None),
    )
    wire = cmd.to_wire()
    assert set(wire) == {"obj"}
    decoded = msgpack.unpackb(base64.b64decode(wire["obj"]), raw=False)
    assert decoded["fPath"] == "/a/b.txt"
    assert decoded["isDir"] is False
    assert decoded["ops"] == {"cf": {}}
    assert decoded["metadata"]["size"] == 10
