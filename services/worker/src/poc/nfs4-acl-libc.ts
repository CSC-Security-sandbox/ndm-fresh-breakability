/**
 * POC: NFSv4 ACL libc bindings via koffi
 *
 * Uses koffi (already in worker package.json) to call getxattr / setxattr
 * directly from libc.so.6 — no subprocess spawn needed.
 *
 * This mirrors how WinOperationService uses koffi → kernel32.dll / advapi32.dll
 * for Windows ADS detection, but for Linux xattr syscalls.
 *
 * getxattr(2):
 *   ssize_t getxattr(const char *path, const char *name, void *value, size_t size);
 *   Returns: number of bytes in the xattr value, or -1 on error (sets errno)
 *
 * setxattr(2):
 *   int setxattr(const char *path, const char *name, const void *value, size_t size, int flags);
 *   Returns: 0 on success, -1 on error (sets errno)
 *   flags: 0 = create or replace, XATTR_CREATE=1, XATTR_REPLACE=2
 *
 * lgetxattr / lsetxattr: same but do not follow symlinks (for symlink support)
 */

import * as koffi from 'koffi';

// ─── Constants ────────────────────────────────────────────────────────────────

export const NFS4_ACL_XATTR_NAME = 'system.nfs4_acl';

/** Initial buffer size for getxattr. If the ACL is larger, we retry with the actual size. */
const INITIAL_BUF_SIZE = 65536; // 64 KB — large enough for any realistic ACL

// XATTR flags for setxattr
export const XATTR_FLAGS = {
  CREATE_OR_REPLACE: 0,
  CREATE_ONLY: 1,   // XATTR_CREATE  — fail if exists
  REPLACE_ONLY: 2,  // XATTR_REPLACE — fail if not exists
} as const;

// ─── koffi initialization ─────────────────────────────────────────────────────

let getxattrFn: any;
let setxattrFn: any;
let lgetxattrFn: any;
let lsetxattrFn: any;
let libcLoaded = false;

/**
 * Load libc and bind getxattr / setxattr / lgetxattr / lsetxattr.
 * Safe to call multiple times — only loads once.
 * Must only be called on Linux (process.platform === 'linux').
 */
export function initLibcXattr(): void {
  if (libcLoaded) return;

  if (process.platform !== 'linux') {
    throw new Error(`libc xattr bindings only supported on Linux (current: ${process.platform})`);
  }

  try {
    const libc = koffi.load('libc.so.6');

    // ssize_t getxattr(...) — koffi does not have ssize_t; use intptr (pointer-sized signed int)
    getxattrFn  = libc.func('intptr getxattr(const char *path, const char *name, void *value, size_t size)');
    setxattrFn  = libc.func('int setxattr(const char *path, const char *name, const void *value, size_t size, int flags)');
    lgetxattrFn = libc.func('intptr lgetxattr(const char *path, const char *name, void *value, size_t size)');
    lsetxattrFn = libc.func('int lsetxattr(const char *path, const char *name, const void *value, size_t size, int flags)');

    libcLoaded = true;
  } catch (err) {
    throw new Error(`Failed to load libc xattr functions via koffi: ${err.message}`);
  }
}

// ─── getxattr wrapper ─────────────────────────────────────────────────────────

/**
 * Read the system.nfs4_acl xattr from a file path.
 * Returns the raw XDR binary buffer.
 * Returns null if the file has no NFSv4 ACL xattr (ENODATA).
 *
 * @param filePath   absolute path to file or directory
 * @param followSymlink  if false, uses lgetxattr (does not follow symlinks)
 */
export function getNfs4AclXattr(filePath: string, followSymlink = true): Buffer | null {
  if (!libcLoaded) initLibcXattr();

  const fn = followSymlink ? getxattrFn : lgetxattrFn;

  // First call: probe actual size (pass size=0 to get required buffer size)
  const probeSize: number = fn(filePath, NFS4_ACL_XATTR_NAME, null, 0);

  if (probeSize === -1) {
    // errno is not directly accessible from koffi; check for common cases
    // ENODATA (61) means no ACL xattr — not an error, just return null
    // We can't reliably read errno here without more koffi setup, so we try the buffer approach
    // and treat very negative results as "no ACL"
    const fallbackBuf = Buffer.alloc(INITIAL_BUF_SIZE);
    const n: number = fn(filePath, NFS4_ACL_XATTR_NAME, fallbackBuf, fallbackBuf.length);
    if (n < 0) return null; // ENODATA or other — no NFSv4 ACL
    return fallbackBuf.subarray(0, n);
  }

  if (probeSize === 0) return null; // empty ACL

  // Allocate exact size and read
  const buf = Buffer.alloc(probeSize);
  const n: number = fn(filePath, NFS4_ACL_XATTR_NAME, buf, buf.length);
  if (n < 0) return null;
  return buf.subarray(0, n);
}

// ─── setxattr wrapper ─────────────────────────────────────────────────────────

/**
 * Write the system.nfs4_acl xattr to a file path.
 * The worker runs as root so EPERM is not a concern.
 *
 * @param filePath       absolute path to file or directory
 * @param xdrBuf         raw XDR-encoded ACL buffer
 * @param followSymlink  if false, uses lsetxattr (does not follow symlinks)
 * @param flags          XATTR_FLAGS.CREATE_OR_REPLACE (default), CREATE_ONLY, or REPLACE_ONLY
 */
export function setNfs4AclXattr(
  filePath: string,
  xdrBuf: Buffer,
  followSymlink = true,
  flags = XATTR_FLAGS.CREATE_OR_REPLACE,
): void {
  if (!libcLoaded) initLibcXattr();

  const fn = followSymlink ? setxattrFn : lsetxattrFn;
  const result: number = fn(filePath, NFS4_ACL_XATTR_NAME, xdrBuf, xdrBuf.length, flags);

  if (result !== 0) {
    throw new Error(
      `setxattr failed for ${filePath} (returned ${result}). ` +
      `Ensure the NFS mount supports ACLs (nfsvers=4.x, server-side ACL enabled). ` +
      `Worker must run as root (confirmed via systemd User=root).`
    );
  }
}
