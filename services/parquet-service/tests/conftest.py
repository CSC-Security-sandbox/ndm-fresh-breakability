"""Shared test fixtures."""

from __future__ import annotations

import pytest


@pytest.fixture
def fake_redis():
    fakeredis = pytest.importorskip("fakeredis")
    return fakeredis.FakeRedis(decode_responses=False)
