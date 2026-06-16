"""Runtime configuration, sourced from env (Helm values / ConfigMap / Secret).

Env is read in `Settings.from_env()` at CALL time, not when the module is imported — so
`get_settings()` reflects the current environment (and tests can inject a custom mapping).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

MB = 1024 * 1024
GB = 1024 * MB


@dataclass(frozen=True)
class Settings:
    # --- Temporal ---
    temporal_address: str
    temporal_namespace: str
    task_queue: str
    # mTLS material (paths) + JWT — D15 / §11. Empty => plaintext (dev only).
    temporal_tls_cert: str
    temporal_tls_key: str
    temporal_tls_ca: str

    # --- Redis ---
    redis_url: str
    consumer_group: str
    stream_batch_size: int
    stream_block_ms: int
    idempotency_ttl_s: int

    # --- Storage / PVC (§8) ---
    data_root: str
    rotate_bytes: int
    row_group_target_bytes: int

    # --- Merge-sort (D11 / §6) ---
    merge_fan_in: int
    merge_mem_budget_bytes: int
    spill_dir: str

    # --- Workers ---
    # NB: no dedicated merge queue — one worker per job runs the whole bundle and the merge child
    # inherits the parent's queue (TS starter leaves the workflow-input merge_task_queue unset).
    max_concurrent_activities: int  # activity ThreadPoolExecutor size per worker
    worker_shutdown_timeout: float  # graceful per-worker shutdown wait (s) before cancelling

    # --- Work-manager config poll (worker-only manager) ---
    worker_config_url: str          # base URL of the service serving the config endpoint
    config_endpoint: str            # path segment: GET /api/v1/work-manager/<config_endpoint>
    poll_interval_s: float          # seconds between config polls
    poll_timeout_s: float           # per-request HTTP timeout for the poll

    # --- Diff (§9) ---
    diff_batch_dirs: int

    # --- Inbound auth (D15) ---
    jwt_public_key_path: str
    jwt_secret: str
    jwt_algorithms: tuple[str, ...]
    jwt_issuer: str
    jwt_audience: str

    # --- API ---
    api_port: int

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        """Build Settings from `env` (defaults to os.environ), read at call time."""
        e = os.environ if env is None else env
        return cls(
            temporal_address=e.get("TEMPORAL_ADDRESS", "temporal:7233"),
            temporal_namespace=e.get("TEMPORAL_NAMESPACE", "default"),
            task_queue=e.get("TASK_QUEUE", "python-pipeline"),
            temporal_tls_cert=e.get("TEMPORAL_TLS_CERT", ""),
            temporal_tls_key=e.get("TEMPORAL_TLS_KEY", ""),
            temporal_tls_ca=e.get("TEMPORAL_TLS_CA", ""),
            redis_url=e.get("REDIS_URL", "redis://default:redis@redis:6379/0"),
            consumer_group=e.get("CONSUMER_GROUP", "pipeline"),
            stream_batch_size=int(e.get("STREAM_BATCH_SIZE", "1000")),
            stream_block_ms=int(e.get("STREAM_BLOCK_MS", "2000")),
            idempotency_ttl_s=int(e.get("IDEMPOTENCY_TTL_S", "86400")),  # D9: 24h
            data_root=e.get("DATA_ROOT", "/data"),
            rotate_bytes=int(e.get("ROTATE_BYTES", str(200 * MB))),  # D7 / §5.3
            row_group_target_bytes=int(e.get("ROW_GROUP_TARGET_BYTES", str(128 * MB))),
            merge_fan_in=int(e.get("MERGE_FAN_IN", "16")),
            merge_mem_budget_bytes=int(e.get("MERGE_MEM_BUDGET_BYTES", str(2 * GB))),
            spill_dir=e.get("SPILL_DIR", "/tmp"),
            max_concurrent_activities=int(e.get("MAX_CONCURRENT_ACTIVITIES", "8")),
            worker_shutdown_timeout=float(e.get("WORKER_SHUTDOWN_TIMEOUT", "10")),
            worker_config_url=e.get("WORKER_CONFIG_URL", "http://config-service:8080"),
            config_endpoint=e.get("CONFIG_ENDPOINT", "parquet-config"),
            poll_interval_s=float(e.get("POLL_INTERVAL_S", "10")),
            poll_timeout_s=float(e.get("POLL_TIMEOUT_S", "5")),
            diff_batch_dirs=int(e.get("DIFF_BATCH_DIRS", "1000")),
            jwt_public_key_path=e.get("JWT_PUBLIC_KEY_PATH", ""),
            jwt_secret=e.get("JWT_SECRET", ""),
            jwt_algorithms=tuple(
                a.strip() for a in e.get("JWT_ALGORITHMS", "RS256").split(",") if a.strip()
            ),
            jwt_issuer=e.get("JWT_ISSUER", ""),
            jwt_audience=e.get("JWT_AUDIENCE", ""),
            api_port=int(e.get("PORT", "6666")),
        )


def get_settings() -> Settings:
    """Single source of truth; reads the environment on each call."""
    return Settings.from_env()
