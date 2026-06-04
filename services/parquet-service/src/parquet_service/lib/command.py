"""OPS_CMD enum + Cmd construction and wire encoding (SPEC §9, D6).

Wire format MUST match the TS `RedisCommandCollection`: msgpack-encoded `Cmd`, base64 in the `obj`
field of the XADD payload. The Cmd shape mirrors `lib/jobs-lib/src/datatype/stream-datatypes.ts`:
  Cmd { id, fPath, status, isDir, ops, metadata?, originalCmdId? }

TODO: verify field names / casing / enum integer values against the TS decoder before go-live.
"""

from __future__ import annotations

import base64
import enum
from dataclasses import asdict, dataclass, field
from typing import Any

import msgpack


class OpsCmd(str, enum.Enum):
    CC = "cc"  # copy content
    SM = "sm"  # stamp metadata (mode/uid/gid AND acl — D6)
    SA = "sa"
    CF = "cf"  # copy file
    CD = "cd"  # create dir
    RD = "rd"  # remove dir
    RF = "rf"  # remove file
    CS = "cs"


@dataclass
class CmdMeta:
    size: int | None = None
    mtime: int | None = None
    atime: int | None = None
    ctime: int | None = None      # null on the Parquet path (SPEC §9 / Q6.2)
    birthtime: int | None = None
    mode: int | None = None
    uid: int | None = None
    gid: int | None = None
    sid: str | None = None        # owner; folded into acl_hash on source side (D6)
    inode: int | None = None
    isSymLink: bool | None = None


@dataclass
class Cmd:
    id: str
    fPath: str
    status: str
    isDir: bool
    ops: dict[str, Any] = field(default_factory=dict)
    metadata: CmdMeta | None = None
    originalCmdId: str | None = None

    def to_wire(self) -> dict[str, str]:
        """Encode to the `{obj: base64(msgpack(cmd))}` stream-entry shape."""
        payload = asdict(self)
        if payload.get("metadata") is None:
            payload.pop("metadata", None)
        if payload.get("originalCmdId") is None:
            payload.pop("originalCmdId", None)
        packed = msgpack.packb(payload, use_bin_type=True)
        return {"obj": base64.b64encode(packed).decode("ascii")}
