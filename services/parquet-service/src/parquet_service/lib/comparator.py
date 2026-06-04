"""ParquetComparator — sort-merge diff over prior/current snapshots, emitting OPS_CMD (SPEC §9, D6/D14).

Inputs per snapshot: `merged` (full rows, retained per D4) + `merkle` (dir_hash + dir own-attrs, D12).
Baseline diffs source-vs-destination; incremental diffs current-source-vs-prior-source.

Per matched directory (read from the merkle Parquets — no merged read for unchanged subtrees):
  1. compare the directory's OWN attribute columns -> emit `sm` if changed (D12).
  2. if dir_hash equal -> skip subtree; else descend into merged rows and compare
     file-children-to-file-children and dir-children-to-dir-children by name (D6).

Delta -> OPS_CMD (D6):
  current-only file -> cf (+sm)      | current-only dir -> cd (+sm)
  prior-only file   -> rf            | prior-only dir   -> rd + subtree (depth DESC)
  size/mtime changed -> cf           | mode/uid/gid/acl_hash changed -> sm
  file<->dir flip handled naturally by separate file/dir passes (no correlation_id).

Ordering: creates depth ASC, deletes depth DESC. CmdMeta.ctime = null on the Parquet path.

Checkpointing (Q4.1): process the join in batches of `batch` directories; for each directory, build
commands -> StreamWriter.push_bulk -> CheckpointStore.save(dir_path). On restart, resume from the cursor
(in-flight dir may re-emit — safe, sync is idempotent). On completion, the caller promotes current->prior
and deletes the older snapshot (D14).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .command import Cmd


# Structural ports so `lib/` stays free of Redis/io imports (SPEC §2). The io/ classes
# (StreamWriter, CheckpointStore) satisfy these by duck-typing.
class CommandSink(Protocol):
    def push_bulk(self, cmds: list[Cmd]) -> list[str]: ...


class Checkpoint(Protocol):
    def load(self) -> str | None: ...
    def save(self, dir_path: str) -> None: ...


@dataclass
class DiffStats:
    dirs_compared: int = 0
    subtrees_skipped: int = 0
    commands_emitted: int = 0


class ParquetComparator:
    def __init__(
        self,
        prior_merged: Path,
        prior_merkle: Path,
        curr_merged: Path,
        curr_merkle: Path,
        writer: CommandSink,
        checkpoint: Checkpoint,
        *,
        batch: int = 1000,
    ) -> None:
        self._prior_merged = prior_merged
        self._prior_merkle = prior_merkle
        self._curr_merged = curr_merged
        self._curr_merkle = curr_merkle
        self._writer = writer
        self._checkpoint = checkpoint
        self._batch = batch

    def run(self) -> DiffStats:
        """Execute the checkpointed sort-merge diff. Resumes from CheckpointStore.load().

        TODO (D3.2):
          * open prior/current merkle Parquets sorted by dir_path; sort-merge join.
          * resume_cursor = checkpoint.load(); skip dirs <= resume_cursor.
          * per matched dir: own-attr compare (-> sm), then dir_hash gate; on mismatch descend into
            merged rows for that dir (file pass + dir pass) per the mapping above.
          * prior-only / current-only directories: walk the subtree from merged, depth ASC creates /
            DESC deletes.
          * accumulate commands; every `batch` dirs -> writer.push_bulk(cmds) then checkpoint.save(dir).
        """
        raise NotImplementedError("sort-merge diff + command emission — see SPEC §9 / D6")

    # --- helpers to implement ---
    def _compare_dir_attrs(self, prior_row: dict | None, curr_row: dict) -> list:  # -> list[Cmd]
        raise NotImplementedError

    def _compare_children(self, dir_path: str) -> list:  # -> list[Cmd]
        raise NotImplementedError
