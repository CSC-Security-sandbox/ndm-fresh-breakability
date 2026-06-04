"""CheckpointStore — diff resume cursor in Redis (SPEC §9, Q4.1).

Stores the last fully-processed `dir_path` for a (jobRunId, sourcePathId) diff. Saved AFTER the
directory's commands are durably pushed to the command stream; on restart the diff resumes from here
(the in-flight directory may re-emit — safe, sync is idempotent on OPS_CMD).
"""

from __future__ import annotations

import redis


class CheckpointStore:
    def __init__(self, client: redis.Redis, job_run_id: str, path_id: str, *, ttl_s: int = 86_400) -> None:
        self._c = client
        self._key = f"{job_run_id}:{path_id}:diff:cursor"
        self._ttl = ttl_s

    def load(self) -> str | None:
        val = self._c.get(self._key)
        if val is None:
            return None
        return val.decode() if isinstance(val, bytes) else str(val)

    def save(self, dir_path: str) -> None:
        self._c.set(self._key, dir_path, ex=self._ttl)

    def clear(self) -> None:
        self._c.delete(self._key)
