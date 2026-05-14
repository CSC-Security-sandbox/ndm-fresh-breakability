/** Default 24h Strategy 4b window; shared by `app.config` and stamp-meta when config is unset. */
export const DEFAULT_ATIME_RELATIME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Strategy 4b (relatime-style): skip expensive source atime restore when a normal
 * relatime policy would not have advanced atime on read anyway.
 * Used only as the **last** gate before Strategy 5 source `utimes` — after read-side
 * strategies (O_NOATIME, mount hints, etc.) have already run.
 * See docs/atime-preservation-strategies.md.
 */
export function shouldRestoreSourceAtimeRelatime(params: {
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  relatimeWindowMs: number;
  nowMs: number;
}): boolean {
  const { atimeMs, mtimeMs, ctimeMs, relatimeWindowMs, nowMs } = params;
  if (atimeMs < mtimeMs) return true;
  if (atimeMs < ctimeMs) return true;
  if (nowMs - atimeMs > relatimeWindowMs) return true;
  return false;
}

export function isErrnoCode(err: unknown, ...codes: string[]): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    codes.includes(String((err as NodeJS.ErrnoException).code))
  );
}

/** Linux open(O_NOATIME): systemic failures to stop retrying for the job run. */
export function isNoatimeOpenCapabilityError(err: unknown): boolean {
  return isErrnoCode(err, 'EOPNOTSUPP', 'EINVAL');
}

/** Often returned when the process cannot use O_NOATIME on this file (ownership). */
export function isNoatimeOpenPermissionStyleError(err: unknown): boolean {
  return isErrnoCode(err, 'EPERM', 'EACCES');
}

/** Log-friendly codes for atime preservation diagnostics (maps to doc strategies). */
export const ATIME_DIAG = {
  READ_NOT_REQUESTED: 'read_path:not_requested',
  WIN_READ_STAMP_FALLBACK: 'read_path:strategy_1_smb_fallback_standard_read_then_stamp',
  STRATEGY_2_O_NOATIME: 'read_path:strategy_2_o_noatime',
  STRATEGY_2_FALLBACK_STD_SAME_FILE: 'read_path:strategy_2_o_noatime_fallback_same_file',
  STRATEGY_2_FALLBACK_STD_SESSION: 'read_path:strategy_2_o_noatime_fallback_session_skip_next',
  STRATEGY_2_KERNEL_NO_FLAG: 'read_path:strategy_2_o_noatime_unavailable_kernel',
  STRATEGY_2_SESSION_SKIP: 'read_path:strategy_2_session_skip_o_noatime',
  STRATEGY_3_MOUNT_NOATIME_OK: 'mount_nfs:strategy_3_noatime_nodiratime',
  STRATEGY_3_MOUNT_FALLBACK: 'mount_nfs:strategy_3_fallback_standard_mount',
  STRATEGY_3_MOUNT_STANDARD_ONLY: 'mount_nfs:strategy_3_standard_mount_only',
  STRATEGY_3_SMB_MOUNT_NOATIME_OK: 'mount_smb:strategy_3_noatime',
  STRATEGY_3_SMB_MOUNT_FALLBACK: 'mount_smb:strategy_3_fallback_standard_mount',
  STRATEGY_3_SMB_MOUNT_STANDARD_ONLY: 'mount_smb:strategy_3_standard_mount_only',
  // Windows SMB mounts via `net use`, which exposes no atime knob to the
  // client. Strategy 3 is therefore structurally unavailable on Windows
  // SMB, leaving Strategy 1 (partial), 4b, 5, and 6 as the realistic ladder.
  STRATEGY_3_SMB_WIN_NOT_APPLICABLE:
    'mount_smb:strategy_3_not_applicable_windows_net_use_no_atime_option',
  STRATEGY_1_SMB_BACKUP_INTENT_ENABLED: 'mount_smb:strategy_1_windows_backup_privileges_enabled',
  STRATEGY_4B_SKIP: 'stamp_source:strategy_4b_relatime_gate_skip_restore',
  STRATEGY_4B_GATE_OFF: 'stamp_source:strategy_4b_gate_disabled_full_restore',
  STRATEGY_5_UTIMES: 'stamp_source:strategy_5_utimes_restore',
  // Strategy 5 source utimes restore is a redundant write whenever an
  // earlier strategy already kept the kernel from bumping atime
  // (Strategy 2 O_NOATIME success or Strategy 3 mount-noatime in effect).
  STRATEGY_5_SKIP_NOATIME_GUARANTEED:
    'stamp_source:strategy_5_skipped_kernel_noatime_guaranteed',
  STRATEGY_6_RO_SKIP: 'stamp_source:strategy_6_readonly_skip_restore',
} as const;

/**
 * Returns true when the read-side strategies guaranteed the source kernel
 * did not update atime on this read, so the Strategy-5 source `utimes`
 * restore is a no-op and may be skipped.
 *
 * Two independent signals can establish the guarantee:
 *  - `atimeReadStrategy === STRATEGY_2_O_NOATIME`: the per-file open used
 *    `O_NOATIME` and the kernel suppressed the atime update for that read.
 *  - `mountNoatimeApplied`: the source filesystem was mounted with
 *    `noatime`/`nodiratime`, in which case the kernel suppresses atime
 *    updates regardless of how individual files were opened. This
 *    subsumes Strategy 2 fallbacks on Linux/macOS (NFS and CIFS/smbfs).
 *
 * Strategy 1 on Windows SMB is intentionally NOT included: today the read
 * path uses Node's standard streams which do bump atime; Strategy 5 is the
 * only mechanism that restores it. When/if a native binding exposes
 * FILE_FLAG_BACKUP_SEMANTICS end-to-end, a `STRATEGY_1_FILE_BACKUP_INTENT`
 * label can be added and gated here.
 */
export function atimeKernelGuaranteed(params: {
  atimeReadStrategy?: string;
  mountNoatimeApplied: boolean;
}): boolean {
  if (params.mountNoatimeApplied) return true;
  return params.atimeReadStrategy === ATIME_DIAG.STRATEGY_2_O_NOATIME;
}
