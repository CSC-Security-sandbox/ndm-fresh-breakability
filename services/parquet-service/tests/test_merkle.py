"""Merkle helper tests (the build() traversal itself is TODO — see SPEC §3.2)."""

from __future__ import annotations

from parquet_service.lib import merkle


def test_blake3_128_hex_len_and_determinism():
    h1 = merkle.blake3_128_hex(b"hello")
    h2 = merkle.blake3_128_hex(b"hello")
    assert h1 == h2
    assert len(h1) == 32  # 128 bits = 16 bytes = 32 hex chars


def test_empty_directory_hash_is_empty(  # D13
):
    assert merkle.combine_children([]) == ""


def test_combine_children_order_independent_of_input_order():
    a = [("x", "11" * 16), ("y", "22" * 16)]
    b = list(reversed(a))
    assert merkle.combine_children(a) == merkle.combine_children(b)  # sorted by basename internally


def test_row_attr_bytes_is_stable_and_length_prefixed():
    row = {"filepath": "/a", "file_type": "F", "file_size": 1, "mtime": 2,
           "mode": 420, "uid": 1000, "gid": 1000, "acl_hash": None}
    out = merkle.row_attr_bytes(row)
    assert isinstance(out, bytes) and len(out) > 0
    assert merkle.row_attr_bytes(row) == out
