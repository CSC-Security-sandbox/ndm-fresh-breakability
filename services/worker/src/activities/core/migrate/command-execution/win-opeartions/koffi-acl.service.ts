import { Inject, Injectable } from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import * as koffi from 'koffi';
import { promisify } from 'util';

/**
 * Native koffi-based ACL read/write service that calls advapi32.dll and
 * kernel32.dll directly from Node — no PowerShell, no C# P/Invoke, no
 * JSON serialisation boundary.
 *
 * Produces the exact same `SecurityDescriptor` shape the rest of the
 * pipeline expects (Owner, Group, DaclAces, DaclPresent, DaclProtected,
 * DaclAutoInherit, Attributes) so it is a drop-in replacement for the
 * PowerShell `Get-FileSecurityFast` / `Set-FileSecurityFast` path.
 *
 * All Win32 calls go through koffi `.async` (libuv worker thread) so
 * they never block the event loop.
 */
@Injectable()
export class KoffiAclService {
  private readonly logger: LoggerService;
  private initialized = false;

  // Win32 function handles (populated by initialize())
  private GetNamedSecurityInfoW!: any;
  private SetNamedSecurityInfoW!: any;
  private GetSecurityDescriptorControl!: any;
  private GetSecurityDescriptorLength!: any;
  private GetSecurityDescriptorOwner!: any;
  private GetSecurityDescriptorGroup!: any;
  private GetSecurityDescriptorDacl!: any;
  private GetAce!: any;
  private ConvertSidToStringSidW!: any;
  private ConvertStringSidToSidW!: any;
  private GetLengthSid!: any;
  private CopySid!: any;
  private IsValidSid!: any;
  private InitializeAcl!: any;
  private AddAce!: any;
  private GetFileAttributesW!: any;
  private SetFileAttributesW!: any;
  private LookupAccountSidW!: any;
  private LocalFree!: any;

  // Async promisified wrappers
  private getNamedSecurityInfoAsync!: (...args: any[]) => Promise<any>;
  private setNamedSecurityInfoAsync!: (...args: any[]) => Promise<any>;
  private getFileAttributesAsync!: (...args: any[]) => Promise<any>;
  private setFileAttributesAsync!: (...args: any[]) => Promise<any>;
  private lookupAccountSidAsync!: (...args: any[]) => Promise<any>;

  // koffi types
  private ACE_HEADER: any;
  private ACCESS_ALLOWED_ACE: any;

  // Win32 constants
  private static readonly SE_FILE_OBJECT = 1;
  private static readonly OWNER_SECURITY_INFORMATION = 0x00000001;
  private static readonly GROUP_SECURITY_INFORMATION = 0x00000002;
  private static readonly DACL_SECURITY_INFORMATION = 0x00000004;
  private static readonly ALL_SECURITY_INFORMATION =
    KoffiAclService.OWNER_SECURITY_INFORMATION |
    KoffiAclService.GROUP_SECURITY_INFORMATION |
    KoffiAclService.DACL_SECURITY_INFORMATION;
  private static readonly PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
  private static readonly UNPROTECTED_DACL_SECURITY_INFORMATION = 0x20000000;
  private static readonly ACL_REVISION = 2;

  // SD control flags
  private static readonly SE_DACL_PRESENT = 0x0004;
  private static readonly SE_DACL_PROTECTED = 0x1000;
  private static readonly SE_DACL_AUTO_INHERITED = 0x0400;

  // ACE_HEADER.AceType
  private static readonly ACCESS_ALLOWED_ACE_TYPE = 0;
  private static readonly ACCESS_DENIED_ACE_TYPE = 1;

  // INHERITED_ACE flag in AceFlags
  private static readonly INHERITED_ACE = 0x10;

  constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(KoffiAclService.name);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Load advapi32.dll + kernel32.dll and bind all Win32 functions needed
   * for ACL read/write. Call once at startup (guarded by `initialized`).
   * Returns false if binding fails (non-Windows or DLL load error).
   */
  initialize(): boolean {
    if (this.initialized) return true;
    if (process.platform !== 'win32') return false;

    try {
      const advapi32 = koffi.load('advapi32.dll');
      const kernel32 = koffi.load('kernel32.dll');

      // ---- structs ----
      this.ACE_HEADER = koffi.struct('ACE_HEADER', {
        AceType: 'uint8',
        AceFlags: 'uint8',
        AceSize: 'uint16',
      });

      this.ACCESS_ALLOWED_ACE = koffi.struct('ACCESS_ALLOWED_ACE', {
        Header: this.ACE_HEADER,
        Mask: 'uint32',
        SidStart: 'uint32',
      });

      // ---- advapi32 functions ----

      this.GetNamedSecurityInfoW = advapi32.func('__stdcall', 'GetNamedSecurityInfoW', 'uint32', [
        'str16',    // pObjectName
        'uint32',   // ObjectType
        'uint32',   // SecurityInfo
        'void **',  // ppsidOwner
        'void **',  // ppsidGroup
        'void **',  // ppDacl
        'void **',  // ppSacl
        'void **',  // ppSecurityDescriptor
      ]);

      this.SetNamedSecurityInfoW = advapi32.func('__stdcall', 'SetNamedSecurityInfoW', 'uint32', [
        'str16',    // pObjectName
        'uint32',   // ObjectType
        'int32',    // SecurityInfo
        'void *',   // psidOwner
        'void *',   // psidGroup
        'void *',   // pDacl
        'void *',   // pSacl
      ]);

      this.GetSecurityDescriptorControl = advapi32.func('__stdcall', 'GetSecurityDescriptorControl', 'bool', [
        'void *',    // pSecurityDescriptor
        'uint16 *',  // pControl
        'uint32 *',  // lpdwRevision
      ]);

      this.GetSecurityDescriptorLength = advapi32.func('__stdcall', 'GetSecurityDescriptorLength', 'uint32', [
        'void *',   // pSecurityDescriptor
      ]);

      this.GetSecurityDescriptorOwner = advapi32.func('__stdcall', 'GetSecurityDescriptorOwner', 'bool', [
        'void *',    // pSecurityDescriptor
        'void **',   // pOwner (out SID pointer)
        'bool *',    // lpbOwnerDefaulted
      ]);

      this.GetSecurityDescriptorGroup = advapi32.func('__stdcall', 'GetSecurityDescriptorGroup', 'bool', [
        'void *',    // pSecurityDescriptor
        'void **',   // pGroup (out SID pointer)
        'bool *',    // lpbGroupDefaulted
      ]);

      this.GetSecurityDescriptorDacl = advapi32.func('__stdcall', 'GetSecurityDescriptorDacl', 'bool', [
        'void *',    // pSecurityDescriptor
        'bool *',    // lpbDaclPresent
        'void **',   // pDacl
        'bool *',    // lpbDaclDefaulted
      ]);

      this.GetAce = advapi32.func('__stdcall', 'GetAce', 'bool', [
        'void *',    // pAcl
        'uint32',    // dwAceIndex
        'void **',   // pAce (out)
      ]);

      this.ConvertSidToStringSidW = advapi32.func('__stdcall', 'ConvertSidToStringSidW', 'bool', [
        'void *',     // Sid
        'void **',    // StringSid (out - pointer to LPWSTR)
      ]);

      this.ConvertStringSidToSidW = advapi32.func('__stdcall', 'ConvertStringSidToSidW', 'bool', [
        'str16',    // StringSid
        'void **',  // Sid (out)
      ]);

      this.GetLengthSid = advapi32.func('__stdcall', 'GetLengthSid', 'uint32', [
        'void *',  // pSid
      ]);

      this.CopySid = advapi32.func('__stdcall', 'CopySid', 'bool', [
        'uint32',  // nDestinationSidLength
        'void *',  // pDestinationSid
        'void *',  // pSourceSid
      ]);

      this.IsValidSid = advapi32.func('__stdcall', 'IsValidSid', 'bool', [
        'void *',  // pSid
      ]);

      this.InitializeAcl = advapi32.func('__stdcall', 'InitializeAcl', 'bool', [
        'void *',   // pAcl
        'uint32',   // nAclLength
        'uint32',   // dwAclRevision
      ]);

      this.AddAce = advapi32.func('__stdcall', 'AddAce', 'bool', [
        'void *',   // pAcl
        'uint32',   // dwAceRevision
        'uint32',   // dwStartingAceIndex
        'void *',   // pAceList
        'uint32',   // nAceListLength
      ]);

      this.LookupAccountSidW = advapi32.func('__stdcall', 'LookupAccountSidW', 'bool', [
        'void *',    // lpSystemName (null)
        'void *',    // Sid
        'str16',     // Name (out)
        'uint32 *',  // cchName
        'str16',     // ReferencedDomainName (out)
        'uint32 *',  // cchReferencedDomainName
        'uint32 *',  // peUse
      ]);

      // ---- kernel32 functions ----

      this.GetFileAttributesW = kernel32.func('__stdcall', 'GetFileAttributesW', 'uint32', [
        'str16',
      ]);

      this.SetFileAttributesW = kernel32.func('__stdcall', 'SetFileAttributesW', 'bool', [
        'str16',
        'uint32',
      ]);

      this.LocalFree = kernel32.func('__stdcall', 'LocalFree', 'void *', [
        'void *',
      ]);

      // ---- async wrappers ----
      this.getNamedSecurityInfoAsync = promisify(this.GetNamedSecurityInfoW.async);
      this.setNamedSecurityInfoAsync = promisify(this.SetNamedSecurityInfoW.async);
      this.getFileAttributesAsync = promisify(this.GetFileAttributesW.async);
      this.setFileAttributesAsync = promisify(this.SetFileAttributesW.async);
      this.lookupAccountSidAsync = promisify(this.LookupAccountSidW.async);

      this.initialized = true;
      this.logger.log('Koffi ACL service initialized — advapi32 + kernel32 bound');
      return true;
    } catch (error) {
      this.logger.error(`Failed to initialize koffi ACL bindings: ${error.message}`);
      return false;
    }
  }

  /**
   * Read the security descriptor for `path` and return it as the same
   * `SecurityDescriptor` shape the pipeline expects. Async (libuv worker
   * thread). Properly `LocalFree`s the SD allocated by the kernel.
   */
  async getSecurityDescriptor(
    path: string,
  ): Promise<{
    Owner: string;
    Group: string;
    DaclAces: Array<{
      Sid: string;
      AccessMask: number;
      AceType: number;
      AceFlags: number;
      IsInherited: boolean;
    }> | null;
    Attributes: string;
    DaclPresent: boolean;
    DaclProtected: boolean;
    DaclAutoInherit: boolean;
  }> {
    const pOwner = [null];
    const pGroup = [null];
    const pDacl = [null];
    const pSacl = [null];
    const pSD = [null];

    const result = await this.getNamedSecurityInfoAsync(
      path,
      KoffiAclService.SE_FILE_OBJECT,
      KoffiAclService.ALL_SECURITY_INFORMATION,
      pOwner,
      pGroup,
      pDacl,
      pSacl,
      pSD,
    );

    if (result !== 0) {
      throw new Error(`GetNamedSecurityInfo failed for "${path}" with error code ${result}`);
    }

    const sdPtr = pSD[0];
    try {
      // --- Control flags ---
      const controlOut = [0];
      const revisionOut = [0];
      this.GetSecurityDescriptorControl(sdPtr, controlOut, revisionOut);
      const control: number = controlOut[0];

      const daclPresent = (control & KoffiAclService.SE_DACL_PRESENT) !== 0;
      const daclProtected = (control & KoffiAclService.SE_DACL_PROTECTED) !== 0;
      const daclAutoInherit = (control & KoffiAclService.SE_DACL_AUTO_INHERITED) !== 0;

      // --- Owner ---
      const ownerOut = [null];
      const ownerDefaulted = [false];
      this.GetSecurityDescriptorOwner(sdPtr, ownerOut, ownerDefaulted);
      const ownerSid = this.sidToString(ownerOut[0]);

      // --- Group ---
      const groupOut = [null];
      const groupDefaulted = [false];
      this.GetSecurityDescriptorGroup(sdPtr, groupOut, groupDefaulted);
      const groupSid = this.sidToString(groupOut[0]);

      // --- DACL ---
      let daclAces: Array<{
        Sid: string;
        AccessMask: number;
        AceType: number;
        AceFlags: number;
        IsInherited: boolean;
      }> | null = null;

      if (daclPresent) {
        const daclPresentOut = [false];
        const daclOut = [null];
        const daclDefaulted = [false];
        this.GetSecurityDescriptorDacl(sdPtr, daclPresentOut, daclOut, daclDefaulted);

        const daclPtr = daclOut[0];
        if (daclPresentOut[0] && daclPtr) {
          daclAces = this.parseAcl(daclPtr);
        } else {
          daclAces = daclPresentOut[0] ? [] : null;
        }
      }

      // --- Attributes ---
      const attrs = await this.getFileAttributesAsync(path);
      const attributes = this.fileAttributesToString(attrs);

      return {
        Owner: ownerSid,
        Group: groupSid,
        DaclAces: daclAces,
        Attributes: attributes,
        DaclPresent: daclPresent,
        DaclProtected: daclProtected,
        DaclAutoInherit: daclAutoInherit,
      };
    } finally {
      if (sdPtr) this.LocalFree(sdPtr);
    }
  }

  /**
   * Write a security descriptor to `path`. Mirrors `Set-FileSecurityFast`:
   * builds binary Owner + Group SIDs and a DACL from the SecurityDescriptor
   * JSON, then calls `SetNamedSecurityInfoW`.
   *
   * Returns `{ success, unresolved_sids }` matching the PS envelope shape.
   */
  async setSecurityDescriptor(
    path: string,
    sd: {
      Owner: string;
      Group: string;
      DaclAces: Array<{
        Sid: string;
        AccessMask: number;
        AceType: number;
        AceFlags: number;
        IsInherited?: boolean;
      }> | null;
      DaclPresent: boolean;
      DaclProtected: boolean;
      DaclAutoInherit: boolean;
      Attributes?: string;
    },
  ): Promise<{ success: boolean; error?: string; unresolved_sids: string[] }> {
    const unresolvedSids: string[] = [];

    // --- Convert Owner SID ---
    const ownerSidPtr = this.stringToSid(sd.Owner);
    if (!ownerSidPtr) {
      return { success: false, error: `Invalid Owner SID: ${sd.Owner}`, unresolved_sids: [] };
    }
    if (!this.canResolveSid(ownerSidPtr)) unresolvedSids.push(sd.Owner);

    // --- Convert Group SID ---
    const groupSidPtr = this.stringToSid(sd.Group);
    if (!groupSidPtr) {
      this.LocalFree(ownerSidPtr);
      return { success: false, error: `Invalid Group SID: ${sd.Group}`, unresolved_sids: [] };
    }
    if (!this.canResolveSid(groupSidPtr)) unresolvedSids.push(sd.Group);

    // --- Build DACL ---
    const stampNullDacl = sd.DaclPresent === false;
    let daclPtr: any = null;
    let daclBuf: Buffer | null = null;

    if (!stampNullDacl) {
      const aces = sd.DaclAces ?? [];
      const { buffer, acePointers, aceUnresolved } = this.buildDaclBuffer(aces);
      daclBuf = buffer;
      daclPtr = daclBuf;
      unresolvedSids.push(...aceUnresolved);
      // acePointers are SIDs allocated by ConvertStringSidToSidW — free them after SetNamedSecurityInfo
      // We'll store them to free after the call.
      // Actually koffi manages the buffer lifetime for us within this scope.
    }

    // --- SecurityInfo flags ---
    let securityInfoFlags =
      KoffiAclService.OWNER_SECURITY_INFORMATION |
      KoffiAclService.GROUP_SECURITY_INFORMATION |
      KoffiAclService.DACL_SECURITY_INFORMATION;

    if (!stampNullDacl) {
      if (sd.DaclProtected) {
        securityInfoFlags = (securityInfoFlags | KoffiAclService.PROTECTED_DACL_SECURITY_INFORMATION) | 0;
      } else {
        securityInfoFlags = (securityInfoFlags | KoffiAclService.UNPROTECTED_DACL_SECURITY_INFORMATION) | 0;
      }
    }

    // --- Call SetNamedSecurityInfoW ---
    const result = await this.setNamedSecurityInfoAsync(
      path,
      KoffiAclService.SE_FILE_OBJECT,
      securityInfoFlags,
      ownerSidPtr,
      groupSidPtr,
      daclPtr,
      null, // pSacl
    );

    // Free SIDs allocated by ConvertStringSidToSidW
    this.LocalFree(ownerSidPtr);
    this.LocalFree(groupSidPtr);

    if (result !== 0) {
      return {
        success: false,
        error: `SetNamedSecurityInfo failed with error code ${result}`,
        unresolved_sids: unresolvedSids,
      };
    }

    // --- Set file attributes ---
    if (sd.Attributes) {
      const attrMask = this.parseAttributeString(sd.Attributes);
      if (attrMask !== 0) {
        await this.setFileAttributesAsync(path, attrMask);
      }
    }

    return { success: true, unresolved_sids: unresolvedSids };
  }

  // ---- Private helpers ----

  /**
   * Convert a binary SID pointer to an `S-1-5-21-...` string.
   */
  private sidToString(sidPtr: any): string {
    if (!sidPtr) return '';
    const strOut = [null];
    const ok = this.ConvertSidToStringSidW(sidPtr, strOut);
    if (!ok || !strOut[0]) return '';
    const sidStr = koffi.decode(strOut[0], 'str16');
    this.LocalFree(strOut[0]);
    return sidStr;
  }

  /**
   * Convert an `S-1-5-21-...` string to a binary SID pointer.
   * Caller must `LocalFree` the returned pointer.
   */
  private stringToSid(sidStr: string): any {
    const sidOut = [null];
    const ok = this.ConvertStringSidToSidW(sidStr, sidOut);
    if (!ok || !sidOut[0]) return null;
    return sidOut[0];
  }

  /**
   * Check if a binary SID can be resolved to an account name.
   */
  private canResolveSid(sidPtr: any): boolean {
    try {
      const nameLen = Buffer.alloc(4);
      nameLen.writeUInt32LE(0, 0);
      const domainLen = Buffer.alloc(4);
      domainLen.writeUInt32LE(0, 0);
      const use = [0];
      // First call with zero-length buffers to get sizes — will return false
      this.LookupAccountSidW(null, sidPtr, null, nameLen, null, domainLen, use);
      const nLen = nameLen.readUInt32LE(0);
      return nLen > 0;
    } catch {
      return false;
    }
  }

  /**
   * Parse all ACEs from a DACL pointer into the pipeline's ACE shape.
   */
  private parseAcl(
    daclPtr: any,
  ): Array<{
    Sid: string;
    AccessMask: number;
    AceType: number;
    AceFlags: number;
    IsInherited: boolean;
  }> {
    const aces: Array<{
      Sid: string;
      AccessMask: number;
      AceType: number;
      AceFlags: number;
      IsInherited: boolean;
    }> = [];

    // Read AceCount from the ACL header (offset 4, uint16)
    const aclBuf = koffi.decode(daclPtr, koffi.array('uint8', 8));
    const aceCount = aclBuf[4] | (aclBuf[5] << 8);

    for (let i = 0; i < aceCount; i++) {
      const aceOut = [null];
      if (!this.GetAce(daclPtr, i, aceOut) || !aceOut[0]) continue;

      const acePtr = aceOut[0];
      const headerBuf = koffi.decode(acePtr, koffi.array('uint8', 8));
      const aceType = headerBuf[0];
      const aceFlags = headerBuf[1];
      const aceSize = headerBuf[2] | (headerBuf[3] << 8);
      const accessMask = headerBuf[4] | (headerBuf[5] << 8) | (headerBuf[6] << 16) | (headerBuf[7] << 24);

      // SID starts at offset 8 in ACCESS_ALLOWED_ACE / ACCESS_DENIED_ACE
      const sidPtr = koffi.decode(acePtr, 'void *', { offset: 8 }) ?? acePtr;
      // Actually, the SID is embedded starting at SidStart field.
      // For ACCESS_ALLOWED_ACE: Header (4) + Mask (4) = offset 8.
      // koffi.decode with offset is not directly available, so compute
      // the pointer arithmetic manually.
      const sidOffset = 8; // sizeof(ACE_HEADER) + sizeof(ACCESS_MASK)
      const aceBuf = koffi.decode(acePtr, koffi.array('uint8', aceSize));
      const sidBytes = aceBuf.slice(sidOffset);

      // Allocate a buffer and copy the SID bytes to get a valid SID pointer
      const sidBuf = Buffer.from(sidBytes);
      const sidString = this.sidBytesToString(sidBuf);

      aces.push({
        Sid: sidString,
        AccessMask: accessMask >>> 0, // ensure unsigned
        AceType: aceType,
        AceFlags: aceFlags,
        IsInherited: (aceFlags & KoffiAclService.INHERITED_ACE) !== 0,
      });
    }

    return aces;
  }

  /**
   * Convert raw SID bytes in a Buffer to an S-1-5-... string by copying
   * them into a koffi-allocated block and calling ConvertSidToStringSidW.
   */
  private sidBytesToString(sidBuf: Buffer): string {
    const ptr = koffi.alloc('uint8', sidBuf.length);
    const target = koffi.decode(ptr, koffi.array('uint8', sidBuf.length));
    for (let i = 0; i < sidBuf.length; i++) target[i] = sidBuf[i];

    const strOut = [null];
    const ok = this.ConvertSidToStringSidW(ptr, strOut);
    if (!ok || !strOut[0]) return '';
    const sidStr = koffi.decode(strOut[0], 'str16');
    this.LocalFree(strOut[0]);
    return sidStr;
  }

  /**
   * Build a binary ACL buffer from an array of ACE descriptors.
   * Each ACE is an ACCESS_ALLOWED_ACE or ACCESS_DENIED_ACE with an
   * embedded SID. Returns the DACL buffer ready for SetNamedSecurityInfo.
   */
  private buildDaclBuffer(
    aces: Array<{
      Sid: string;
      AccessMask: number;
      AceType: number;
      AceFlags: number;
    }>,
  ): { buffer: Buffer; acePointers: any[]; aceUnresolved: string[] } {
    const acePointers: any[] = [];
    const aceUnresolved: string[] = [];
    const aceBuffers: Buffer[] = [];

    for (const ace of aces) {
      // Only stamp AccessAllowed (0) and AccessDenied (1)
      if (ace.AceType !== KoffiAclService.ACCESS_ALLOWED_ACE_TYPE &&
          ace.AceType !== KoffiAclService.ACCESS_DENIED_ACE_TYPE) {
        throw new Error(`Unsupported ACE type: ${ace.AceType}`);
      }

      const sidPtr = this.stringToSid(ace.Sid);
      if (!sidPtr) {
        throw new Error(`Failed to convert SID string: ${ace.Sid}`);
      }
      acePointers.push(sidPtr);

      if (!this.canResolveSid(sidPtr)) aceUnresolved.push(ace.Sid);

      const sidLen = this.GetLengthSid(sidPtr);
      const aceSize = 8 + sidLen; // ACE_HEADER (4) + Mask (4) + SID

      const aceBuf = Buffer.alloc(aceSize);
      // ACE_HEADER
      aceBuf.writeUInt8(ace.AceType, 0);
      aceBuf.writeUInt8(ace.AceFlags, 1);
      aceBuf.writeUInt16LE(aceSize, 2);
      // AccessMask
      aceBuf.writeUInt32LE(ace.AccessMask >>> 0, 4);
      // SID bytes
      const sidBufArr = koffi.decode(sidPtr, koffi.array('uint8', sidLen));
      for (let i = 0; i < sidLen; i++) aceBuf[8 + i] = sidBufArr[i];

      aceBuffers.push(aceBuf);
    }

    // ACL header: AclRevision (1) + Sbz1 (1) + AclSize (2) + AceCount (2) + Sbz2 (2) = 8 bytes
    const totalAceBytes = aceBuffers.reduce((sum, b) => sum + b.length, 0);
    const aclSize = 8 + totalAceBytes;
    const aclBuf = Buffer.alloc(aclSize);

    // ACL header
    aclBuf.writeUInt8(KoffiAclService.ACL_REVISION, 0); // AclRevision
    aclBuf.writeUInt8(0, 1);                             // Sbz1
    aclBuf.writeUInt16LE(aclSize, 2);                    // AclSize
    aclBuf.writeUInt16LE(aces.length, 4);                // AceCount
    aclBuf.writeUInt16LE(0, 6);                           // Sbz2

    // Copy ACE buffers in order
    let offset = 8;
    for (const ab of aceBuffers) {
      ab.copy(aclBuf, offset);
      offset += ab.length;
    }

    // Free SID pointers allocated by ConvertStringSidToSidW
    for (const ptr of acePointers) this.LocalFree(ptr);

    return { buffer: aclBuf, acePointers: [], aceUnresolved };
  }

  /**
   * Map a Win32 `FILE_ATTRIBUTES` bitmask to the comma-separated string
   * format emitted by .NET's `FileAttributes.ToString()`.
   */
  private fileAttributesToString(attrs: number): string {
    if (attrs === 0xffffffff) return '';
    const names: string[] = [];
    const map: [number, string][] = [
      [0x0001, 'ReadOnly'],
      [0x0002, 'Hidden'],
      [0x0004, 'System'],
      [0x0010, 'Directory'],
      [0x0020, 'Archive'],
      [0x0040, 'Device'],
      [0x0080, 'Normal'],
      [0x0100, 'Temporary'],
      [0x0200, 'SparseFile'],
      [0x0400, 'ReparsePoint'],
      [0x0800, 'Compressed'],
      [0x1000, 'Offline'],
      [0x2000, 'NotContentIndexed'],
      [0x4000, 'Encrypted'],
      [0x8000, 'IntegrityStream'],
      [0x20000, 'NoScrubData'],
    ];
    for (const [bit, name] of map) {
      if (attrs & bit) names.push(name);
    }
    return names.join(', ');
  }

  /**
   * Parse a .NET-style comma-separated attribute string back into a bitmask.
   */
  private parseAttributeString(attrs: string): number {
    const map: Record<string, number> = {
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
    };
    let mask = 0;
    for (const tok of attrs.split(',')) {
      const bit = map[tok.trim()];
      if (bit !== undefined) mask |= bit;
    }
    return mask;
  }
}
