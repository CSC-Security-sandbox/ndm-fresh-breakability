"""StreamReader — per-(jobRunId, pathId) Redis stream consumer (SPEC §4).

Generalizes the prototype's ItemStream to:
  * keyed streams: filemeta -> "{jobRunId}:{pathId}:parquet", errors -> "{jobRunId}:errors"
  * ack-after-seal: ack() is called by the caller ONLY after the owning Parquet is sealed (D7).

Wire format: msgpack payload, base64, under the `obj` field (matches RedisParquetItemCollection).
EOF: entry field `eof=1` OR decoded payload `filePath=LAST_FILE`, plus a `{key}:state` hash `eofSeen=1`.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Literal

import msgpack
import redis

logger = logging.getLogger(__name__)

PAYLOAD_FIELD = "obj"
EOF_FIELD = "eof"
EOF_VALUE = "1"
EOF_LAST_FILE = "LAST_FILE"

Kind = Literal["filemeta", "errors"]


def _s(x: object) -> str:
    """Decode a Redis value to str whether the client is in bytes or text mode."""
    return x.decode() if isinstance(x, (bytes, bytearray)) else str(x)


class StreamReader:
    def __init__(
        self,
        client: redis.Redis,
        job_run_id: str,
        path_id: str | None,
        kind: Kind,
        *,
        group: str = "pipeline",
    ) -> None:
        self._c = client
        self._group = group
        self._kind = kind
        if kind == "filemeta":
            if not path_id:
                raise ValueError("path_id is required for filemeta streams")
            self.stream_key = f"{job_run_id}:{path_id}:parquet"
        else:
            self.stream_key = f"{job_run_id}:errors"
        self.state_key = f"{self.stream_key}:state"

    def ensure_group(self) -> None:
        try:
            self._c.xgroup_create(self.stream_key, self._group, id="0", mkstream=True)
        except redis.ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

    def consume(self, consumer: str, count: int, block_ms: int) -> list[tuple[str, dict[str, str]]]:
        resp = self._c.xreadgroup(
            groupname=self._group,
            consumername=consumer,
            streams={self.stream_key: ">"},
            count=count,
            block=block_ms,
        )
        if not resp:
            return []
        out: list[tuple[str, dict[str, str]]] = []
        for _stream, entries in resp:
            for entry_id, fields in entries:
                out.append((_s(entry_id), {_s(k): _s(v) for k, v in (fields or {}).items()}))
        return out

    @staticmethod
    def decode(fields: dict[str, str]) -> dict[str, Any] | None:
        raw = fields.get(PAYLOAD_FIELD)
        if not raw:
            return None
        try:
            return msgpack.unpackb(base64.b64decode(raw), raw=False)
        except Exception as exc:  # noqa: BLE001
            logger.warning("failed to decode payload on %s: %s", PAYLOAD_FIELD, exc)
            return None

    @classmethod
    def is_eof(cls, fields: dict[str, str]) -> bool:
        if str(fields.get(EOF_FIELD, "")) == EOF_VALUE:
            return True
        payload = cls.decode(fields)
        if isinstance(payload, dict):
            if payload.get(EOF_FIELD):
                return True
            if str(payload.get("filePath", "")) == EOF_LAST_FILE:
                return True
        return False

    def eof_seen(self) -> bool:
        try:
            val = self._c.hget(self.state_key, "eofSeen")
            return val is not None and _s(val).lower() in ("1", "true")
        except Exception:  # noqa: BLE001
            return False

    def ack(self, entry_ids: list[str]) -> int:
        """XACK processed entries. Call ONLY after the owning Parquet is sealed (D7)."""
        if not entry_ids:
            return 0
        return int(self._c.xack(self.stream_key, self._group, *entry_ids))
