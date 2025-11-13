// Windows API native bindings - Windows only
// This module uses ffi-napi which only works on Windows and requires native compilation
// On non-Windows platforms, all functions will throw errors or return false

const isWindows = process.platform === 'win32';

// Windows API Constants
export const SE_FILE_OBJECT = 1;
export const OWNER_SECURITY_INFORMATION = 0x00000001;
export const GROUP_SECURITY_INFORMATION = 0x00000002;
export const DACL_SECURITY_INFORMATION = 0x00000004;
export const SACL_SECURITY_INFORMATION = 0x00000008;
export const ALL_SECURITY_INFORMATION =
  OWNER_SECURITY_INFORMATION |
  GROUP_SECURITY_INFORMATION |
  DACL_SECURITY_INFORMATION;

export const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
export const UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000;

// NetAPI constants
export const SHARE_INFO_502 = 502;
export const NERR_Success = 0;

// Lazy load ffi-napi only on Windows
let ffi: any = null;
let ref: any = null;
let advapi32: any = null;
let netapi32: any = null;
let kernel32: any = null;

function loadNativeModules(): { ffi: any; ref: any } | null {
  if (!isWindows) {
    return null;
  }

  try {
    // Only try to load on Windows
    ffi = require('ffi-napi');
    ref = require('ref-napi');
    return { ffi, ref };
  } catch (error) {
    // Native modules not available (not installed or compilation failed)
    return null;
  }
}

function initializeWindowsApis(): boolean {
  if (!isWindows) {
    return false;
  }

  const modules = loadNativeModules();
  if (!modules) {
    return false;
  }

  try {
    const { ffi: ffiModule, ref: refModule } = modules;
    
    // Type definitions
    const IntPtr = refModule.refType(refModule.types.void);
    const IntPtrPtr = refModule.refType(IntPtr);
    const UInt32 = refModule.types.uint32;
    const Int32 = refModule.types.int32;
    const UInt16 = refModule.types.uint16;
    const CharPtr = refModule.types.CString;

    // advapi32.dll - Security APIs
    advapi32 = ffiModule.Library('advapi32', {
      GetNamedSecurityInfo: [
        UInt32,
        [CharPtr, UInt32, UInt32, IntPtrPtr, IntPtrPtr, IntPtrPtr, IntPtrPtr, IntPtrPtr],
      ],
      SetNamedSecurityInfo: [
        UInt32,
        [CharPtr, UInt32, Int32, IntPtr, IntPtr, IntPtr, IntPtr],
      ],
      GetSecurityDescriptorLength: [
        UInt32,
        [IntPtr],
      ],
      ConvertStringSidToSid: [
        'bool',
        [CharPtr, IntPtrPtr],
      ],
      ConvertSidToStringSid: [
        'bool',
        [IntPtr, IntPtrPtr],
      ],
      LocalFree: [
        IntPtr,
        [IntPtr],
      ],
    });

    // netapi32.dll - Network Share APIs
    netapi32 = ffiModule.Library('netapi32', {
      NetShareGetInfo: [
        UInt32,
        [CharPtr, CharPtr, UInt16, IntPtrPtr],
      ],
      NetShareSetInfo: [
        UInt32,
        [CharPtr, CharPtr, UInt16, CharPtr, IntPtrPtr],
      ],
      NetApiBufferFree: [
        UInt32,
        [IntPtr],
      ],
    });

    // kernel32.dll - Memory and error handling
    kernel32 = ffiModule.Library('kernel32', {
      GetLastError: [
        UInt32,
        [],
      ],
      FormatMessage: [
        UInt32,
        [
          UInt32,
          IntPtr,
          UInt32,
          UInt32,
          CharPtr,
          UInt32,
          IntPtr,
        ],
      ],
    });

    return true;
  } catch (error) {
    return false;
  }
}

// Initialize on module load (only on Windows)
const apisInitialized = initializeWindowsApis();

/**
 * Check if Windows APIs are available
 */
export function isWindowsApiAvailable(): boolean {
  return isWindows && apisInitialized && advapi32 !== null && netapi32 !== null;
}

/**
 * Get Windows error message from error code
 */
export function getWindowsErrorMessage(errorCode: number): string {
  if (!isWindowsApiAvailable() || !kernel32) {
    return `Windows API Error: ${errorCode}`;
  }

  const FORMAT_MESSAGE_ALLOCATE_BUFFER = 0x00000100;
  const FORMAT_MESSAGE_FROM_SYSTEM = 0x00001000;
  const FORMAT_MESSAGE_IGNORE_INSERTS = 0x00000200;

  try {
    const buffer = Buffer.alloc(256);
    const length = kernel32.FormatMessage(
      FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
      ref.NULL,
      errorCode,
      0,
      buffer,
      buffer.length,
      ref.NULL,
    );

    if (length > 0) {
      return buffer.toString('utf16le', 0, length * 2).trim();
    }
  } catch (error) {
    // Fall through to default error message
  }

  return `Windows API Error: ${errorCode}`;
}

/**
 * Get last Windows error code
 */
export function getLastError(): number {
  if (!isWindowsApiAvailable() || !kernel32) {
    return 0;
  }
  return kernel32.GetLastError();
}

/**
 * Convert SID string to binary SID
 */
export function convertStringSidToSid(stringSid: string): Buffer | null {
  if (!isWindowsApiAvailable() || !advapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const ppSid = ref.alloc(ref.refType(ref.types.void));
  const result = advapi32.ConvertStringSidToSid(stringSid, ppSid);

  if (!result) {
    const errorCode = getLastError();
    throw new Error(
      `Failed to convert SID string to binary: ${getWindowsErrorMessage(errorCode)}`,
    );
  }

  const sidPtr = ppSid.deref();
  if (sidPtr.isNull()) {
    throw new Error('ConvertStringSidToSid returned null pointer');
  }

  // Read the SID structure
  const revision = sidPtr.readUInt8(0);
  const subAuthCount = sidPtr.readUInt8(1);
  const sidLength = 8 + subAuthCount * 4;
  const sidBuffer = Buffer.alloc(sidLength);
  sidPtr.copy(sidBuffer, 0, 0, sidLength);

  // Free the SID allocated by ConvertStringSidToSid
  advapi32.LocalFree(sidPtr);

  return sidBuffer;
}

/**
 * Convert binary SID to string
 */
export function convertSidToStringSid(sidBuffer: Buffer): string {
  if (!isWindowsApiAvailable() || !advapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const sidPtr = Buffer.alloc(sidBuffer.length);
  sidBuffer.copy(sidPtr);

  const ppStringSid = ref.alloc(ref.refType(ref.types.void));
  const result = advapi32.ConvertSidToStringSid(sidPtr, ppStringSid);

  if (!result) {
    const errorCode = getLastError();
    throw new Error(
      `Failed to convert binary SID to string: ${getWindowsErrorMessage(errorCode)}`,
    );
  }

  const stringSidPtr = ppStringSid.deref();
  if (stringSidPtr.isNull()) {
    throw new Error('ConvertSidToStringSid returned null pointer');
  }

  const stringSid = stringSidPtr.readCString();
  advapi32.LocalFree(stringSidPtr);

  return stringSid;
}

/**
 * Get security descriptor for a file or directory
 */
export function getNamedSecurityInfo(
  objectName: string,
  objectType: number = SE_FILE_OBJECT,
  securityInfo: number = ALL_SECURITY_INFORMATION,
): {
  ownerSid: Buffer | null;
  groupSid: Buffer | null;
  dacl: Buffer | null;
  sacl: Buffer | null;
  securityDescriptor: Buffer;
} {
  if (!isWindowsApiAvailable() || !advapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const IntPtr = ref.refType(ref.types.void);
  const IntPtrPtr = ref.refType(IntPtr);

  const ppOwnerSid = ref.alloc(IntPtrPtr);
  const ppGroupSid = ref.alloc(IntPtrPtr);
  const ppDacl = ref.alloc(IntPtrPtr);
  const ppSacl = ref.alloc(IntPtrPtr);
  const ppSecurityDescriptor = ref.alloc(IntPtrPtr);

  const result = advapi32.GetNamedSecurityInfo(
    objectName,
    objectType,
    securityInfo,
    ppOwnerSid,
    ppGroupSid,
    ppDacl,
    ppSacl,
    ppSecurityDescriptor,
  );

  if (result !== 0) {
    throw new Error(
      `GetNamedSecurityInfo failed: ${getWindowsErrorMessage(result)}`,
    );
  }

  const ownerSidPtr = ppOwnerSid.deref();
  const groupSidPtr = ppGroupSid.deref();
  const daclPtr = ppDacl.deref();
  const saclPtr = ppSacl.deref();
  const sdPtr = ppSecurityDescriptor.deref();

  if (sdPtr.isNull()) {
    throw new Error('GetNamedSecurityInfo returned null security descriptor');
  }

  const sdLength = advapi32.GetSecurityDescriptorLength(sdPtr);
  const sdBuffer = Buffer.alloc(sdLength);
  sdPtr.copy(sdBuffer, 0, 0, sdLength);

  let ownerSid: Buffer | null = null;
  if (!ownerSidPtr.isNull()) {
    const ownerSidLength = getSidLength(ownerSidPtr);
    ownerSid = Buffer.alloc(ownerSidLength);
    ownerSidPtr.copy(ownerSid, 0, 0, ownerSidLength);
  }

  let groupSid: Buffer | null = null;
  if (!groupSidPtr.isNull()) {
    const groupSidLength = getSidLength(groupSidPtr);
    groupSid = Buffer.alloc(groupSidLength);
    groupSidPtr.copy(groupSid, 0, 0, groupSidLength);
  }

  let dacl: Buffer | null = null;
  if (!daclPtr.isNull()) {
    const aclSize = daclPtr.readUInt16LE(2);
    dacl = Buffer.alloc(aclSize);
    daclPtr.copy(dacl, 0, 0, aclSize);
  }

  let sacl: Buffer | null = null;
  if (!saclPtr.isNull()) {
    const aclSize = saclPtr.readUInt16LE(2);
    sacl = Buffer.alloc(aclSize);
    saclPtr.copy(sacl, 0, 0, aclSize);
  }

  advapi32.LocalFree(sdPtr);

  return {
    ownerSid,
    groupSid,
    dacl,
    sacl,
    securityDescriptor: sdBuffer,
  };
}

/**
 * Set security descriptor for a file or directory
 */
export function setNamedSecurityInfo(
  objectName: string,
  objectType: number,
  securityInfo: number,
  ownerSid: Buffer | null,
  groupSid: Buffer | null,
  dacl: Buffer | null,
  sacl: Buffer | null,
): void {
  if (!isWindowsApiAvailable() || !advapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const ownerPtr = ownerSid ? Buffer.from(ownerSid) : ref.NULL;
  const groupPtr = groupSid ? Buffer.from(groupSid) : ref.NULL;
  const daclPtr = dacl ? Buffer.from(dacl) : ref.NULL;
  const saclPtr = sacl ? Buffer.from(sacl) : ref.NULL;

  const result = advapi32.SetNamedSecurityInfo(
    objectName,
    objectType,
    securityInfo,
    ownerPtr,
    groupPtr,
    daclPtr,
    saclPtr,
  );

  if (result !== 0) {
    throw new Error(
      `SetNamedSecurityInfo failed: ${getWindowsErrorMessage(result)}`,
    );
  }
}

/**
 * Get SID length from SID pointer
 */
function getSidLength(sidPtr: any): number {
  if (sidPtr.isNull()) {
    return 0;
  }

  const revision = sidPtr.readUInt8(0);
  const subAuthCount = sidPtr.readUInt8(1);
  return 8 + subAuthCount * 4;
}

/**
 * Get share information (for share-level permissions)
 */
export function netShareGetInfo(
  serverName: string | null,
  netName: string,
  level: number = SHARE_INFO_502,
): Buffer {
  if (!isWindowsApiAvailable() || !netapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const IntPtr = ref.refType(ref.types.void);
  const IntPtrPtr = ref.refType(IntPtr);
  const UInt16 = ref.types.uint16;
  const CharPtr = ref.types.CString;

  const server = serverName || ref.NULL;
  const bufptr = ref.alloc(IntPtrPtr);

  const result = netapi32.NetShareGetInfo(server, netName, level, bufptr);

  if (result !== NERR_Success) {
    throw new Error(
      `NetShareGetInfo failed: ${getWindowsErrorMessage(result)} (code: ${result})`,
    );
  }

  const bufferPtr = bufptr.deref();
  if (bufferPtr.isNull()) {
    throw new Error('NetShareGetInfo returned null buffer');
  }

  const buffer = Buffer.alloc(1024);
  bufferPtr.copy(buffer, 0, 0, Math.min(1024, bufferPtr.length || 1024));

  return buffer;
}

/**
 * Set share information (for share-level permissions)
 */
export function netShareSetInfo(
  serverName: string | null,
  netName: string,
  level: number,
  buffer: Buffer,
): void {
  if (!isWindowsApiAvailable() || !netapi32 || !ref) {
    throw new Error('Windows API not available on this platform');
  }

  const UInt32 = ref.types.uint32;
  const server = serverName || ref.NULL;
  const parmErr = ref.alloc(UInt32);

  const result = netapi32.NetShareSetInfo(
    server,
    netName,
    level,
    buffer,
    parmErr,
  );

  if (result !== NERR_Success) {
    const errorMsg = getWindowsErrorMessage(result);
    const parmErrValue = parmErr.deref();
    throw new Error(
      `NetShareSetInfo failed: ${errorMsg} (code: ${result}, parm_err: ${parmErrValue})`,
    );
  }
}

/**
 * Free NetAPI buffer
 */
export function netApiBufferFree(buffer: Buffer): void {
  if (!isWindowsApiAvailable() || !netapi32) {
    return;
  }

  const bufferPtr = Buffer.from(buffer);
  netapi32.NetApiBufferFree(bufferPtr);
}
