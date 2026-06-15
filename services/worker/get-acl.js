/**
 * Standalone ACL reader — calls Win32 GetNamedSecurityInfoW directly via koffi
 * and prints the security descriptor (Owner, Group, DACL ACEs, control flags,
 * file attributes) for a given path.
 *
 * Usage:
 *   node get-acl.js "C:\\path\\to\\file-or-folder"
 *   node get-acl.js            (defaults to this script's own path)
 *
 * This is a self-contained mirror of KoffiAclService.getSecurityDescriptor,
 * intended for ad-hoc verification of the native read path outside Nest.
 */
'use strict';

const koffi = require('koffi');

// ---- Win32 constants ----
const SE_FILE_OBJECT = 1;
const OWNER_SECURITY_INFORMATION = 0x00000001;
const GROUP_SECURITY_INFORMATION = 0x00000002;
const DACL_SECURITY_INFORMATION = 0x00000004;
const ALL_SECURITY_INFORMATION =
  OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;

// SD control flags
const SE_DACL_PRESENT = 0x0004;
const SE_DACL_PROTECTED = 0x1000;
const SE_DACL_AUTO_INHERITED = 0x0400;

// ACE flags
const INHERITED_ACE = 0x10;

const ACE_TYPE_NAMES = {
  0: 'ACCESS_ALLOWED',
  1: 'ACCESS_DENIED',
  2: 'SYSTEM_AUDIT',
  9: 'ACCESS_ALLOWED_CALLBACK',
  10: 'ACCESS_DENIED_CALLBACK',
};

function loadApi() {
  const advapi32 = koffi.load('advapi32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  // NOTE: koffi only copies pointer outputs back to JS when the parameter is
  // marked with koffi.out(). Without it, _Out_ params stay null/unchanged.
  return {
    GetNamedSecurityInfoW: advapi32.func('__stdcall', 'GetNamedSecurityInfoW', 'uint32', [
      'str16', 'uint32', 'uint32',
      koffi.out('void **'), koffi.out('void **'), koffi.out('void **'),
      koffi.out('void **'), koffi.out('void **'),
    ]),
    GetSecurityDescriptorControl: advapi32.func('__stdcall', 'GetSecurityDescriptorControl', 'bool', [
      'void *', koffi.out('uint16 *'), koffi.out('uint32 *'),
    ]),
    GetSecurityDescriptorOwner: advapi32.func('__stdcall', 'GetSecurityDescriptorOwner', 'bool', [
      'void *', koffi.out('void **'), koffi.out('bool *'),
    ]),
    GetSecurityDescriptorGroup: advapi32.func('__stdcall', 'GetSecurityDescriptorGroup', 'bool', [
      'void *', koffi.out('void **'), koffi.out('bool *'),
    ]),
    GetSecurityDescriptorDacl: advapi32.func('__stdcall', 'GetSecurityDescriptorDacl', 'bool', [
      'void *', koffi.out('bool *'), koffi.out('void **'), koffi.out('bool *'),
    ]),
    GetAce: advapi32.func('__stdcall', 'GetAce', 'bool', ['void *', 'uint32', koffi.out('void **')]),
    ConvertSidToStringSidW: advapi32.func('__stdcall', 'ConvertSidToStringSidW', 'bool', [
      'void *', koffi.out('void **'),
    ]),
    GetFileAttributesW: kernel32.func('__stdcall', 'GetFileAttributesW', 'uint32', ['str16']),
    LocalFree: kernel32.func('__stdcall', 'LocalFree', 'void *', ['void *']),
  };
}

function sidToString(api, sidPtr) {
  if (!sidPtr) return '';
  const strOut = [null];
  const ok = api.ConvertSidToStringSidW(sidPtr, strOut);
  if (!ok || !strOut[0]) return '';
  const sidStr = koffi.decode(strOut[0], 'char16_t', -1);
  api.LocalFree(strOut[0]);
  return sidStr;
}

/**
 * Copy raw SID bytes into stable koffi-allocated memory, then convert to a
 * string. Uses koffi.encode (write) — NOT mutation of a koffi.decode result,
 * which does not write back to native memory.
 */
function sidBytesToString(api, sidBuf) {
  const ptr = koffi.alloc('uint8', sidBuf.length);
  try {
    koffi.encode(ptr, 'uint8', Array.from(sidBuf), sidBuf.length);
    const strOut = [null];
    const ok = api.ConvertSidToStringSidW(ptr, strOut);
    if (!ok || !strOut[0]) return '';
    const sidStr = koffi.decode(strOut[0], 'char16_t', -1);
    api.LocalFree(strOut[0]);
    return sidStr;
  } finally {
    koffi.free(ptr);
  }
}

function parseAcl(api, daclPtr) {
  const aces = [];
  // ACL header: AceCount is a uint16 at offset 4
  const aclHeader = koffi.decode(daclPtr, koffi.array('uint8', 8));
  const aceCount = aclHeader[4] | (aclHeader[5] << 8);

  for (let i = 0; i < aceCount; i++) {
    const aceOut = [null];
    if (!api.GetAce(daclPtr, i, aceOut) || !aceOut[0]) {
      console.warn(`  [warn] GetAce failed at index ${i}, skipping`);
      continue;
    }
    const acePtr = aceOut[0];
    const header = koffi.decode(acePtr, koffi.array('uint8', 8));
    const aceType = header[0];
    const aceFlags = header[1];
    const aceSize = header[2] | (header[3] << 8);
    const accessMask = (header[4] | (header[5] << 8) | (header[6] << 16) | (header[7] << 24)) >>> 0;

    // SID is embedded at offset 8: ACE_HEADER (4) + AccessMask (4)
    const sidOffset = 8;
    const aceBytes = koffi.decode(acePtr, koffi.array('uint8', aceSize));
    const sidBytes = Buffer.from(aceBytes.slice(sidOffset));
    const sid = sidBytesToString(api, sidBytes);

    aces.push({
      Sid: sid,
      AccessMask: `0x${accessMask.toString(16).padStart(8, '0')}`,
      AceType: `${aceType} (${ACE_TYPE_NAMES[aceType] ?? 'UNKNOWN'})`,
      AceFlags: `0x${aceFlags.toString(16).padStart(2, '0')}`,
      IsInherited: (aceFlags & INHERITED_ACE) !== 0,
    });
  }
  return aces;
}

function getSecurityDescriptor(api, path) {
  const pOwner = [null];
  const pGroup = [null];
  const pDacl = [null];
  const pSacl = [null];
  const pSD = [null];

  const result = api.GetNamedSecurityInfoW(
    path, SE_FILE_OBJECT, ALL_SECURITY_INFORMATION,
    pOwner, pGroup, pDacl, pSacl, pSD,
  );
  if (result !== 0) {
    throw new Error(`GetNamedSecurityInfo failed for "${path}" with error code ${result}`);
  }

  const sdPtr = pSD[0];
  try {
    const controlOut = [0];
    const revisionOut = [0];
    api.GetSecurityDescriptorControl(sdPtr, controlOut, revisionOut);
    const control = controlOut[0];

    const daclPresent = (control & SE_DACL_PRESENT) !== 0;
    const daclProtected = (control & SE_DACL_PROTECTED) !== 0;
    const daclAutoInherit = (control & SE_DACL_AUTO_INHERITED) !== 0;

    const ownerOut = [null];
    api.GetSecurityDescriptorOwner(sdPtr, ownerOut, [false]);
    const owner = sidToString(api, ownerOut[0]);

    const groupOut = [null];
    api.GetSecurityDescriptorGroup(sdPtr, groupOut, [false]);
    const group = sidToString(api, groupOut[0]);

    let daclAces = null;
    if (daclPresent) {
      const daclPresentOut = [false];
      const daclOut = [null];
      api.GetSecurityDescriptorDacl(sdPtr, daclPresentOut, daclOut, [false]);
      if (daclPresentOut[0] && daclOut[0]) {
        daclAces = parseAcl(api, daclOut[0]);
      } else {
        daclAces = daclPresentOut[0] ? [] : null;
      }
    }

    const attrs = api.GetFileAttributesW(path);

    return {
      Path: path,
      Owner: owner,
      Group: group,
      DaclPresent: daclPresent,
      DaclProtected: daclProtected,
      DaclAutoInherit: daclAutoInherit,
      DaclAceCount: daclAces === null ? 'null (NULL DACL)' : daclAces.length,
      DaclAces: daclAces,
      AttributesRaw: `0x${(attrs >>> 0).toString(16)}`,
    };
  } finally {
    if (sdPtr) api.LocalFree(sdPtr);
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.error('This script only runs on Windows (advapi32/kernel32).');
    process.exit(1);
  }

  const targetPath = process.argv[2] || __filename;
  console.log(`Reading ACL for: ${targetPath}\n`);

  const api = loadApi();
  const sd = getSecurityDescriptor(api, targetPath);
  console.log(JSON.stringify(sd, null, 2));
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  process.exit(1);
});

try {
  main();
} catch (err) {
  console.error('[error]', err && err.stack ? err.stack : err);
  process.exit(1);
}
