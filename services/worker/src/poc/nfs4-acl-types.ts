/**
 * POC: NFSv4 ACL Types
 *
 * Mirrors the Windows-side types in acl-operation.type.ts but for NFSv4 ACEs.
 * The text format used by nfs4_getfacl / nfs4_setfacl is:
 *   type:flags:principal:permissions
 * e.g. "A::OWNER@:rwatTnNcCoy"
 *
 * The binary format stored in the system.nfs4_acl xattr is XDR (RFC 7531):
 *   [uint32 BE: ace_count]
 *   for each ACE:
 *     [uint32 BE: type]
 *     [uint32 BE: flags]
 *     [uint32 BE: access_mask]
 *     [uint32 BE: who_len]
 *     [who_len bytes: who (UTF-8)]
 *     [0-3 bytes: XDR 4-byte alignment padding]
 */

// ─── ACE type codes ──────────────────────────────────────────────────────────
export const ACE4_TYPE = {
  ACCESS_ALLOWED: 0x00000000, // 'A' - Allow
  ACCESS_DENIED:  0x00000001, // 'D' - Deny
  SYSTEM_AUDIT:   0x00000002, // 'U' - Audit
  SYSTEM_ALARM:   0x00000003, // 'L' - Alarm
} as const;

export const ACE4_TYPE_CHAR: Record<number, 'A' | 'D' | 'U' | 'L'> = {
  [ACE4_TYPE.ACCESS_ALLOWED]: 'A',
  [ACE4_TYPE.ACCESS_DENIED]:  'D',
  [ACE4_TYPE.SYSTEM_AUDIT]:   'U',
  [ACE4_TYPE.SYSTEM_ALARM]:   'L',
};

export const ACE4_TYPE_NUM: Record<'A' | 'D' | 'U' | 'L', number> = {
  A: ACE4_TYPE.ACCESS_ALLOWED,
  D: ACE4_TYPE.ACCESS_DENIED,
  U: ACE4_TYPE.SYSTEM_AUDIT,
  L: ACE4_TYPE.SYSTEM_ALARM,
};

// ─── ACE flag bits ────────────────────────────────────────────────────────────
export const ACE4_FLAG = {
  FILE_INHERIT:          0x00000001, // 'f'
  DIRECTORY_INHERIT:     0x00000002, // 'd'
  NO_PROPAGATE_INHERIT:  0x00000004, // 'n'
  INHERIT_ONLY:          0x00000008, // 'i'
  SUCCESSFUL_ACCESS:     0x00000010, // 'S'
  FAILED_ACCESS:         0x00000020, // 'F'
  IDENTIFIER_GROUP:      0x00000040, // 'g'
} as const;

// flag char → bit value
export const FLAG_CHAR_TO_BIT: Record<string, number> = {
  f: ACE4_FLAG.FILE_INHERIT,
  d: ACE4_FLAG.DIRECTORY_INHERIT,
  n: ACE4_FLAG.NO_PROPAGATE_INHERIT,
  i: ACE4_FLAG.INHERIT_ONLY,
  S: ACE4_FLAG.SUCCESSFUL_ACCESS,
  F: ACE4_FLAG.FAILED_ACCESS,
  g: ACE4_FLAG.IDENTIFIER_GROUP,
};

export const FLAG_BIT_TO_CHAR: Array<[number, string]> = [
  [ACE4_FLAG.FILE_INHERIT,         'f'],
  [ACE4_FLAG.DIRECTORY_INHERIT,    'd'],
  [ACE4_FLAG.NO_PROPAGATE_INHERIT, 'n'],
  [ACE4_FLAG.INHERIT_ONLY,         'i'],
  [ACE4_FLAG.SUCCESSFUL_ACCESS,    'S'],
  [ACE4_FLAG.FAILED_ACCESS,        'F'],
  [ACE4_FLAG.IDENTIFIER_GROUP,     'g'],
];

// ─── ACE permission bits (acemask4) ──────────────────────────────────────────
export const ACE4_PERM = {
  READ_DATA:        0x00000001, // 'r' (list-dir)
  WRITE_DATA:       0x00000002, // 'w' (create-file)
  APPEND_DATA:      0x00000004, // 'a' (create-subdir)
  READ_NAMED_ATTRS: 0x00000008, // 'n'
  WRITE_NAMED_ATTRS:0x00000010, // 'N'
  EXECUTE:          0x00000020, // 'x'
  DELETE_CHILD:     0x00000040, // 'D'
  READ_ATTRIBUTES:  0x00000080, // 't'
  WRITE_ATTRIBUTES: 0x00000100, // 'T'
  DELETE:           0x00010000, // 'd' -- collision with dir-inherit flag in text; context-sensitive
  READ_ACL:         0x00020000, // 'c'
  WRITE_ACL:        0x00040000, // 'C'
  WRITE_OWNER:      0x00080000, // 'o'
  SYNCHRONIZE:      0x00100000, // 'y'
} as const;

// The nfs4_getfacl permission letter ordering (as produced by nfs-acl-tools)
// Letters: r w a n N x D t T d c C o y
export const PERM_CHAR_TO_BIT: Record<string, number> = {
  r: ACE4_PERM.READ_DATA,
  w: ACE4_PERM.WRITE_DATA,
  a: ACE4_PERM.APPEND_DATA,
  n: ACE4_PERM.READ_NAMED_ATTRS,
  N: ACE4_PERM.WRITE_NAMED_ATTRS,
  x: ACE4_PERM.EXECUTE,
  D: ACE4_PERM.DELETE_CHILD,
  t: ACE4_PERM.READ_ATTRIBUTES,
  T: ACE4_PERM.WRITE_ATTRIBUTES,
  d: ACE4_PERM.DELETE,
  c: ACE4_PERM.READ_ACL,
  C: ACE4_PERM.WRITE_ACL,
  o: ACE4_PERM.WRITE_OWNER,
  y: ACE4_PERM.SYNCHRONIZE,
};

export const PERM_BIT_ORDER: Array<[number, string]> = [
  [ACE4_PERM.READ_DATA,         'r'],
  [ACE4_PERM.WRITE_DATA,        'w'],
  [ACE4_PERM.APPEND_DATA,       'a'],
  [ACE4_PERM.READ_NAMED_ATTRS,  'n'],
  [ACE4_PERM.WRITE_NAMED_ATTRS, 'N'],
  [ACE4_PERM.EXECUTE,           'x'],
  [ACE4_PERM.DELETE_CHILD,      'D'],
  [ACE4_PERM.READ_ATTRIBUTES,   't'],
  [ACE4_PERM.WRITE_ATTRIBUTES,  'T'],
  [ACE4_PERM.DELETE,            'd'],
  [ACE4_PERM.READ_ACL,          'c'],
  [ACE4_PERM.WRITE_ACL,         'C'],
  [ACE4_PERM.WRITE_OWNER,       'o'],
  [ACE4_PERM.SYNCHRONIZE,       'y'],
];

// ─── Parsed ACE (text form) ───────────────────────────────────────────────────
export interface Nfs4AceText {
  type: 'A' | 'D' | 'U' | 'L';
  flags: string;       // raw flag chars, e.g. "fd", "g", ""
  principal: string;   // e.g. "OWNER@", "alice@corp.com"
  permissions: string; // raw perm chars, e.g. "rwatTnNcCoy"
  /** Populated during identity mapping before stamp */
  originalPrincipal?: string;
}

// ─── Parsed ACE (binary / numeric form, after XDR decode) ────────────────────
export interface Nfs4AceBinary {
  type: number;       // ACE4_TYPE.*
  flags: number;      // bitmask of ACE4_FLAG.*
  accessMask: number; // bitmask of ACE4_PERM.*
  who: string;        // UTF-8 principal string
}

// ─── Validator output (mirrors Windows ValidatorOutput) ──────────────────────
export interface Nfs4ValidatorOutput {
  sourceAcl: string; // human-readable summary of source ACEs
  targetAcl: string; // human-readable summary of target ACEs
  invalid: string;   // mismatch description (empty = all OK)
}

// ─── Special principals that require no identity mapping ─────────────────────
export const NFS4_SPECIAL_PRINCIPALS = new Set(['OWNER@', 'GROUP@', 'EVERYONE@']);
