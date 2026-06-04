"""Runtime configuration, sourced from env (Helm values / ConfigMap / Secret)."""

from __future__ import annotations

import os
from dataclasses import dataclass

MB = 1024 * 1024
GB = 1024 * MB


@dataclass(frozen=True)
class Settings:
    # --- Temporal ---
    temporal_address: str = os.environ.get("TEMPORAL_ADDRESS", "temporal:7233")
    temporal_namespace: str = os.environ.get("TEMPORAL_NAMESPACE", "default")
    task_queue: str = os.environ.get("TASK_QUEUE", "python-pipeline")
    # mTLS material (paths) + JWT — D15 / §11. Empty => plaintext (dev only).
    temporal_tls_cert: str = os.environ.get("TEMPORAL_TLS_CERT", "")
    temporal_tls_key: str = os.environ.get("TEMPORAL_TLS_KEY", "")
    temporal_tls_ca: str = os.environ.get("TEMPORAL_TLS_CA", "")

    # --- Redis ---
    redis_url: str = os.environ.get("REDIS_URL", "redis://default:redis@redis:6379/0")
    consumer_group: str = os.environ.get("CONSUMER_GROUP", "pipeline")
    stream_batch_size: int = int(os.environ.get("STREAM_BATCH_SIZE", "1000"))
    stream_block_ms: int = int(os.environ.get("STREAM_BLOCK_MS", "2000"))
    idempotency_ttl_s: int = int(os.environ.get("IDEMPOTENCY_TTL_S", "86400"))  # D9: 24h

    # --- Storage / PVC (§8) ---
    data_root: str = os.environ.get("DATA_ROOT", "/data")
    rotate_bytes: int = int(os.environ.get("ROTATE_BYTES", str(200 * MB)))      # D7 / §5.3
    row_group_target_bytes: int = int(os.environ.get("ROW_GROUP_TARGET_BYTES", str(128 * MB)))

    # --- Merge-sort (D11 / §6) ---
    merge_fan_in: int = int(os.environ.get("MERGE_FAN_IN", "16"))
    merge_mem_budget_bytes: int = int(os.environ.get("MERGE_MEM_BUDGET_BYTES", str(2 * GB)))
    spill_dir: str = os.environ.get("SPILL_DIR", "/tmp")

    # --- Diff (§9) ---
    diff_batch_dirs: int = int(os.environ.get("DIFF_BATCH_DIRS", "1000"))

    # --- Inbound auth (D15) ---
    jwt_public_key_path: str = os.environ.get("JWT_PUBLIC_KEY_PATH", "")
    jwt_secret: str = os.environ.get("JWT_SECRET", "")
    jwt_algorithms: tuple[str, ...] = tuple(
        a.strip() for a in os.environ.get("JWT_ALGORITHMS", "RS256").split(",") if a.strip()
    )
    jwt_issuer: str = os.environ.get("JWT_ISSUER", "")
    jwt_audience: str = os.environ.get("JWT_AUDIENCE", "")

    # --- API ---
    api_port: int = int(os.environ.get("PORT", "6666"))


def get_settings() -> Settings:
    """Single source of truth; re-read per process start."""
    return Settings()
