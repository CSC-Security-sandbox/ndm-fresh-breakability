"""StreamWriter — push OPS_CMD commands to `{jobRunId}:commands` (SPEC §4 / §7).

Wire format matches RedisCommandCollection: XADD with `obj` = base64(msgpack(Cmd)).
"""

from __future__ import annotations

import redis

from ..lib.command import Cmd


class StreamWriter:
    def __init__(self, client: redis.Redis, job_run_id: str) -> None:
        self._c = client
        self.stream_key = f"{job_run_id}:commands"

    def push(self, cmd: Cmd) -> str:
        return str(self._c.xadd(self.stream_key, cmd.to_wire()))

    def push_bulk(self, cmds: list[Cmd]) -> list[str]:
        if not cmds:
            return []
        pipe = self._c.pipeline(transaction=False)
        for cmd in cmds:
            pipe.xadd(self.stream_key, cmd.to_wire())
        return [str(x) for x in pipe.execute()]
