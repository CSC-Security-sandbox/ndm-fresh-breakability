/**
 * POC: NFSv4 ACL XDR Binary Parser and Serializer
 *
 * Implements RFC 7531 section 4 (nfsace4 XDR encoding).
 *
 * Wire format (all integers big-endian / network byte order):
 *   [uint32: ace_count N]
 *   for i in 0..N-1:
 *     [uint32: type]
 *     [uint32: flags]
 *     [uint32: access_mask]
 *     [uint32: who_length L]
 *     [L bytes: who (UTF-8, NOT null-terminated)]
 *     [pad bytes: (4 - L%4) % 4 zero bytes for XDR 4-byte alignment]
 *
 * ONTAP note: ONTAP exports `system.nfs4_acl` in this exact RFC 7531 XDR format.
 * Linux kernel NFS client: same format.
 * TrueNAS / ZFS: uses `system.nfs4_acl_xdr` with same encoding (different xattr name).
 */

import {
  Nfs4AceBinary,
  Nfs4AceText,
  ACE4_TYPE_CHAR,
  ACE4_TYPE_NUM,
  FLAG_CHAR_TO_BIT,
  FLAG_BIT_TO_CHAR,
  PERM_CHAR_TO_BIT,
  PERM_BIT_ORDER,
} from './nfs4-acl-types';

// ─── XDR decode: Buffer → Nfs4AceBinary[] ────────────────────────────────────

export function xdrDecodeAcl(buf: Buffer): Nfs4AceBinary[] {
  if (buf.length < 4) {
    throw new Error(`XDR buffer too short: ${buf.length} bytes`);
  }

  let offset = 0;

  const aceCount = buf.readUInt32BE(offset);
  offset += 4;

  if (aceCount === 0) return [];
  if (aceCount > 1024) {
    throw new Error(`Unreasonably large ACE count: ${aceCount} — likely wrong xattr or wrong offset`);
  }

  const aces: Nfs4AceBinary[] = [];

  for (let i = 0; i < aceCount; i++) {
    if (offset + 16 > buf.length) {
      throw new Error(`XDR buffer truncated at ACE ${i}: offset=${offset}, bufLen=${buf.length}`);
    }

    const type       = buf.readUInt32BE(offset);     offset += 4;
    const flags      = buf.readUInt32BE(offset);     offset += 4;
    const accessMask = buf.readUInt32BE(offset);     offset += 4;
    const whoLen     = buf.readUInt32BE(offset);     offset += 4;

    if (offset + whoLen > buf.length) {
      throw new Error(`XDR who string truncated at ACE ${i}: whoLen=${whoLen}, remaining=${buf.length - offset}`);
    }

    const who = buf.subarray(offset, offset + whoLen).toString('utf8');
    offset += whoLen;

    // XDR 4-byte alignment padding
    const pad = (4 - (whoLen % 4)) % 4;
    offset += pad;

    aces.push({ type, flags, accessMask, who });
  }

  return aces;
}

// ─── XDR encode: Nfs4AceBinary[] → Buffer ────────────────────────────────────

export function xdrEncodeAcl(aces: Nfs4AceBinary[]): Buffer {
  // Calculate total buffer size first
  let totalSize = 4; // ace_count field
  for (const ace of aces) {
    const whoBytes = Buffer.from(ace.who, 'utf8');
    const pad = (4 - (whoBytes.length % 4)) % 4;
    totalSize += 4 + 4 + 4 + 4 + whoBytes.length + pad; // type+flags+mask+wholen+who+pad
  }

  const buf = Buffer.alloc(totalSize, 0);
  let offset = 0;

  buf.writeUInt32BE(aces.length, offset); offset += 4;

  for (const ace of aces) {
    const whoBytes = Buffer.from(ace.who, 'utf8');
    const pad = (4 - (whoBytes.length % 4)) % 4;

    buf.writeUInt32BE(ace.type,       offset); offset += 4;
    buf.writeUInt32BE(ace.flags,      offset); offset += 4;
    buf.writeUInt32BE(ace.accessMask, offset); offset += 4;
    buf.writeUInt32BE(whoBytes.length, offset); offset += 4;
    whoBytes.copy(buf, offset); offset += whoBytes.length;
    // padding bytes are already 0 from Buffer.alloc
    offset += pad;
  }

  return buf;
}

// ─── Convert binary ACE → text ACE (for display / comparison) ────────────────

export function binaryToText(ace: Nfs4AceBinary): Nfs4AceText {
  const typeChar = ACE4_TYPE_CHAR[ace.type];
  if (!typeChar) {
    throw new Error(`Unknown ACE type: 0x${ace.type.toString(16)}`);
  }

  // Decode flags bitmask → char string
  const flagsStr = FLAG_BIT_TO_CHAR
    .filter(([bit]) => (ace.flags & bit) !== 0)
    .map(([, ch]) => ch)
    .join('');

  // Decode permission bitmask → char string
  const permsStr = PERM_BIT_ORDER
    .filter(([bit]) => (ace.accessMask & bit) !== 0)
    .map(([, ch]) => ch)
    .join('');

  return {
    type: typeChar,
    flags: flagsStr,
    principal: ace.who,
    permissions: permsStr,
  };
}

// ─── Convert text ACE → binary ACE ───────────────────────────────────────────

export function textToBinary(ace: Nfs4AceText): Nfs4AceBinary {
  const typeNum = ACE4_TYPE_NUM[ace.type];
  if (typeNum === undefined) {
    throw new Error(`Unknown ACE type char: '${ace.type}'`);
  }

  // Encode flags string → bitmask
  let flags = 0;
  for (const ch of ace.flags) {
    const bit = FLAG_CHAR_TO_BIT[ch];
    if (bit !== undefined) flags |= bit;
  }

  // Encode permissions string → bitmask
  let accessMask = 0;
  for (const ch of ace.permissions) {
    const bit = PERM_CHAR_TO_BIT[ch];
    if (bit !== undefined) accessMask |= bit;
  }

  return {
    type: typeNum,
    flags,
    accessMask,
    who: ace.principal,
  };
}

// ─── Parse nfs4_getfacl text output → Nfs4AceText[] ─────────────────────────
// Handles the text format output by nfs4_getfacl:
//   # file: /path/to/file        ← optional header line
//   A::OWNER@:rwatTnNcCoy        ← ACE line
//   A:g:GROUP@:rtncy
//   A::EVERYONE@:rtncy
//   D::alice@corp.com:w

export function parseNfs4GetfaclOutput(output: string): Nfs4AceText[] {
  const aces: Nfs4AceText[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Must match type:flags:principal:permissions
    const parts = line.split(':');
    if (parts.length < 4) continue;
    const type = parts[0] as 'A' | 'D' | 'U' | 'L';
    if (!['A', 'D', 'U', 'L'].includes(type)) continue;
    // principal may contain @ and domain, but always separated by exactly 3 colons
    // e.g.  A::OWNER@:rwx  →  ['A','','OWNER@','rwx']
    //        A:g:GROUP@:rtncy → ['A','g','GROUP@','rtncy']
    const flags       = parts[1];
    const permissions = parts[parts.length - 1];
    const principal   = parts.slice(2, parts.length - 1).join(':');
    aces.push({ type, flags, principal, permissions });
  }
  return aces;
}

// ─── Format Nfs4AceText[] → nfs4_setfacl -S input string ────────────────────

export function formatAcesForSetfacl(aces: Nfs4AceText[]): string {
  return aces.map(ace => `${ace.type}:${ace.flags}:${ace.principal}:${ace.permissions}`).join('\n');
}

// ─── Human-readable ACL summary (for logging / validation output) ─────────────

export function summarizeAces(aces: Nfs4AceText[]): string {
  return aces.map(ace =>
    `${ace.type}:${ace.flags || ''}:${ace.principal}:${ace.permissions}`
  ).join(' | ');
}
