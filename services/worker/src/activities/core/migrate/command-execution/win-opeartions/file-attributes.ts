/**
 * Shared NTFS file-attribute helpers for the SMB metadata pipeline.
 *
 * Lives in its own module (rather than on `WinOperationService`) because
 * both the stamp-time post-validator (`WinOperationService.validateAclOperation`)
 * and the scan-time gate
 * (`SecurityDescriptorChangeDetectorService.securityDescriptorEquals`)
 * need the same attribute mask. Hosting it on one service and importing
 * into the other would create an asymmetric ownership relationship that
 * neither service actually owns — these are facts about NTFS, not about
 * ACL I/O or the change-detector.
 */

/**
 * Numeric values from `System.IO.FileAttributes`. Only the attributes
 * `[System.IO.File]::SetAttributes` can actually write end up in the
 * comparison mask; attributes that require separate Win32 syscalls
 * (`FSCTL_SET_COMPRESSION`, `EncryptFile`, `FSCTL_SET_SPARSE`, etc.) are
 * deliberately excluded so a missing-on-destination value cannot trigger
 * an infinite stamp loop.
 */
export const FILE_ATTRIBUTE_FLAGS: Readonly<Record<string, number>> = Object.freeze({
  ReadOnly: 0x0001,
  Hidden: 0x0002,
  System: 0x0004,
  Directory: 0x0010,
  Archive: 0x0020,
  Device: 0x0040,
  Normal: 0x0080,
  Temporary: 0x0100,
  SparseFile: 0x0200,
  ReparsePoint: 0x0400,
  Compressed: 0x0800,
  Offline: 0x1000,
  NotContentIndexed: 0x2000,
  Encrypted: 0x4000,
  IntegrityStream: 0x8000,
  NoScrubData: 0x20000,
});

/**
 * Subset of `FILE_ATTRIBUTE_FLAGS` that the stamp pipeline can actually
 * persist. Used by the validator and the gate as a positive allowlist;
 * any bit outside this mask is dropped before equality checks so drift
 * the pipeline can't act on cannot stall the gate.
 */
export const STAMPABLE_ATTR_MASK =
  FILE_ATTRIBUTE_FLAGS.ReadOnly |
  FILE_ATTRIBUTE_FLAGS.Hidden |
  FILE_ATTRIBUTE_FLAGS.System |
  FILE_ATTRIBUTE_FLAGS.Archive |
  FILE_ATTRIBUTE_FLAGS.Normal |
  FILE_ATTRIBUTE_FLAGS.Temporary |
  FILE_ATTRIBUTE_FLAGS.Offline |
  FILE_ATTRIBUTE_FLAGS.NotContentIndexed;

/**
 * Parse the comma-separated attribute string emitted by the reader's
 * `[System.IO.File]::GetAttributes($path).ToString()` call and return the
 * stampable bitmask. Whitespace around tokens is tolerated; unknown
 * tokens are silently dropped (mirrors `FileAttributes.Parse` behaviour
 * for our subset). Returns `0` for `undefined`/empty input.
 */
export function parseStampableAttributes(attrs: string | undefined): number {
  if (!attrs) return 0;
  let mask = 0;
  for (const raw of attrs.split(',')) {
    const tok = raw.trim();
    const bit = FILE_ATTRIBUTE_FLAGS[tok];
    if (bit !== undefined) mask |= bit;
  }
  return mask & STAMPABLE_ATTR_MASK;
}
