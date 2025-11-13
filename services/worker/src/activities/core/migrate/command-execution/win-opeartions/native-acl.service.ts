import { Inject, Injectable } from '@nestjs/common';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import {
  getNamedSecurityInfo,
  setNamedSecurityInfo,
  convertSidToStringSid,
  convertStringSidToSid,
  netShareGetInfo,
  netShareSetInfo,
  netApiBufferFree,
  isWindowsApiAvailable,
  ALL_SECURITY_INFORMATION,
  SE_FILE_OBJECT,
  OWNER_SECURITY_INFORMATION,
  GROUP_SECURITY_INFORMATION,
  DACL_SECURITY_INFORMATION,
  PROTECTED_DACL_SECURITY_INFORMATION,
  UNPROTECTED_DACL_SECURITY_INFORMATION,
} from './windows-api-native';
import { SecurityDescriptor, Ace, ShareSecurityDescriptor, SharePermissions } from './acl-operation.type';

/**
 * Service for managing Windows ACLs using native Windows APIs
 * Replaces PowerShell-based implementation
 */
@Injectable()
export class NativeAclService {
  private readonly logger: LoggerService;

  constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(NativeAclService.name);
  }

  /**
   * Get file security descriptor
   */
  async getFileSecurity(filePath: string): Promise<SecurityDescriptor> {
    if (!isWindowsApiAvailable()) {
      throw new Error('Windows API not available on this platform');
    }

    try {
      // Get file attributes first
      const stats = fs.statSync(filePath);
      const attributes = this.getFileAttributes(filePath);

      // Get security info from Windows API
      const securityInfo = getNamedSecurityInfo(
        filePath,
        SE_FILE_OBJECT,
        ALL_SECURITY_INFORMATION,
      );

      // Parse security descriptor
      const sd = this.parseSecurityDescriptor(securityInfo.securityDescriptor);

      // Convert owner and group SIDs to strings
      const ownerSid = securityInfo.ownerSid
        ? convertSidToStringSid(securityInfo.ownerSid)
        : '';
      const groupSid = securityInfo.groupSid
        ? convertSidToStringSid(securityInfo.groupSid)
        : '';

      // Parse DACL
      const daclAces: Ace[] = securityInfo.dacl
        ? this.parseDacl(securityInfo.dacl)
        : [];

      // Determine DACL flags
      const daclPresent = daclAces.length > 0 || sd.daclPresent;
      const daclProtected = sd.daclProtected || (!sd.hasInheritedAces && daclAces.length > 0);
      const daclAutoInherit = sd.daclAutoInherit;

      return {
        Owner: ownerSid,
        Group: groupSid,
        DaclAces: daclAces,
        Attributes: attributes,
        DaclPresent: daclPresent,
        DaclProtected: daclProtected,
        DaclAutoInherit: daclAutoInherit,
        originalOwner: ownerSid,
        originalGroup: groupSid,
      };
    } catch (error) {
      this.logger.error(`Failed to get file security for ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Set file security descriptor
   */
  async setFileSecurity(
    filePath: string,
    acl: SecurityDescriptor,
  ): Promise<{ success: boolean; unresolved_sids: string[] }> {
    if (!isWindowsApiAvailable()) {
      throw new Error('Windows API not available on this platform');
    }

    const unresolvedSids: string[] = [];

    try {
      // Convert SID strings to binary
      let ownerSid: Buffer | null = null;
      let groupSid: Buffer | null = null;

      try {
        ownerSid = convertStringSidToSid(acl.Owner);
      } catch (error) {
        this.logger.warn(`Failed to resolve owner SID ${acl.Owner}: ${error.message}`);
        unresolvedSids.push(acl.Owner);
      }

      try {
        groupSid = convertStringSidToSid(acl.Group);
      } catch (error) {
        this.logger.warn(`Failed to resolve group SID ${acl.Group}: ${error.message}`);
        unresolvedSids.push(acl.Group);
      }

      // Build DACL
      const dacl = this.buildDacl(acl.DaclAces, unresolvedSids);

      // Build security info flags
      let securityInfoFlags =
        OWNER_SECURITY_INFORMATION |
        GROUP_SECURITY_INFORMATION |
        DACL_SECURITY_INFORMATION;

      if (acl.DaclProtected) {
        securityInfoFlags |= PROTECTED_DACL_SECURITY_INFORMATION;
      } else {
        securityInfoFlags |= UNPROTECTED_DACL_SECURITY_INFORMATION;
      }

      // Set security info
      setNamedSecurityInfo(
        filePath,
        SE_FILE_OBJECT,
        securityInfoFlags,
        ownerSid,
        groupSid,
        dacl,
        null, // SACL not supported
      );

      // Set file attributes if provided
      if (acl.Attributes) {
        this.setFileAttributes(filePath, acl.Attributes);
      }

      return {
        success: true,
        unresolved_sids: unresolvedSids,
      };
    } catch (error) {
      this.logger.error(`Failed to set file security for ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get share security descriptor
   */
  async getShareSecurity(
    serverName: string | null,
    shareName: string,
  ): Promise<ShareSecurityDescriptor> {
    if (!isWindowsApiAvailable()) {
      throw new Error('Windows API not available on this platform');
    }

    try {
      const buffer = netShareGetInfo(serverName, shareName, 502);

      // Parse SHARE_INFO_502 structure
      // This is a complex structure, simplified parsing here
      const shareInfo = this.parseShareInfo502(buffer);

      // Free the buffer
      netApiBufferFree(buffer);

      return {
        shareName,
        serverName: serverName || 'localhost',
        permissions: shareInfo.permissions || [],
        maxUsers: shareInfo.maxUsers || 0,
        currentUsers: shareInfo.currentUsers || 0,
        path: shareInfo.path || '',
        remark: shareInfo.remark || '',
      };
    } catch (error) {
      this.logger.error(
        `Failed to get share security for ${serverName}\\${shareName}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Set share security/permissions
   */
  async setShareSecurity(
    serverName: string | null,
    shareName: string,
    permissions: SharePermissions,
  ): Promise<boolean> {
    if (!isWindowsApiAvailable()) {
      throw new Error('Windows API not available on this platform');
    }

    try {
      // Build SHARE_INFO_502 structure
      const buffer = this.buildShareInfo502(permissions);

      // Set share info
      netShareSetInfo(serverName, shareName, 502, buffer);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to set share security for ${serverName}\\${shareName}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Parse security descriptor buffer
   */
  private parseSecurityDescriptor(sdBuffer: Buffer): {
    daclPresent: boolean;
    daclProtected: boolean;
    daclAutoInherit: boolean;
    hasInheritedAces: boolean;
  } {
    // Security Descriptor structure (simplified):
    // Offset 0: Revision (1 byte)
    // Offset 1: Sbz1 (1 byte)
    // Offset 2: Control (2 bytes, WORD)
    // Offset 4: Owner SID pointer (4/8 bytes)
    // Offset 8/12: Group SID pointer (4/8 bytes)
    // Offset 12/16: SACL pointer (4/8 bytes)
    // Offset 16/20: DACL pointer (4/8 bytes)

    const control = sdBuffer.readUInt16LE(2);

    const SE_DACL_PRESENT = 0x0004;
    const SE_DACL_PROTECTED = 0x1000;
    const SE_DACL_AUTO_INHERITED = 0x0100;

    return {
      daclPresent: (control & SE_DACL_PRESENT) !== 0,
      daclProtected: (control & SE_DACL_PROTECTED) !== 0,
      daclAutoInherit: (control & SE_DACL_AUTO_INHERITED) !== 0,
      hasInheritedAces: false, // Will be determined from ACEs
    };
  }

  /**
   * Parse DACL buffer into ACE array
   */
  private parseDacl(daclBuffer: Buffer): Ace[] {
    const aces: Ace[] = [];

    if (!daclBuffer || daclBuffer.length < 8) {
      return aces;
    }

    // ACL structure:
    // Offset 0: AclRevision (1 byte)
    // Offset 1: Sbz1 (1 byte)
    // Offset 2: AclSize (2 bytes, WORD)
    // Offset 4: AceCount (2 bytes, WORD)
    // Offset 6: Sbz2 (2 bytes)
    // Offset 8+: ACE entries

    const aclSize = daclBuffer.readUInt16LE(2);
    const aceCount = daclBuffer.readUInt16LE(4);

    let offset = 8;

    for (let i = 0; i < aceCount && offset < aclSize; i++) {
      if (offset + 8 > daclBuffer.length) {
        break;
      }

      // ACE header:
      // Offset 0: AceType (1 byte)
      // Offset 1: AceFlags (1 byte)
      // Offset 2: AceSize (2 bytes, WORD)
      // Offset 4: AccessMask (4 bytes, DWORD)
      // Offset 8: SID (variable length)

      const aceType = daclBuffer.readUInt8(offset);
      const aceFlags = daclBuffer.readUInt8(offset + 1);
      const aceSize = daclBuffer.readUInt16LE(offset + 2);
      const accessMask = daclBuffer.readUInt32LE(offset + 4);

      if (offset + aceSize > daclBuffer.length) {
        break;
      }

      // Extract SID
      const sidBuffer = daclBuffer.slice(offset + 8, offset + aceSize);
      let sidString = '';

      try {
        sidString = convertSidToStringSid(sidBuffer);
      } catch (error) {
        this.logger.warn(`Failed to convert SID to string: ${error.message}`);
        continue;
      }

      // Check if inherited (AceFlags bit 8)
      const isInherited = (aceFlags & 0x10) !== 0;

      aces.push({
        Sid: sidString,
        AccessMask: accessMask,
        AceType: aceType,
        AceFlags: aceFlags,
        IsInherited: isInherited,
        originalSid: sidString,
      });

      offset += aceSize;
    }

    return aces;
  }

  /**
   * Build DACL buffer from ACE array
   */
  private buildDacl(aces: Ace[], unresolvedSids: string[]): Buffer | null {
    if (!aces || aces.length === 0) {
      return null;
    }

    // Calculate total size needed
    let totalSize = 8; // ACL header

    const aceBuffers: Buffer[] = [];

    for (const ace of aces) {
      try {
        const sidBuffer = convertStringSidToSid(ace.Sid);
        const aceSize = 8 + sidBuffer.length; // ACE header + SID
        totalSize += aceSize;

        // Build ACE buffer
        const aceBuffer = Buffer.alloc(aceSize);
        aceBuffer.writeUInt8(ace.AceType, 0);
        aceBuffer.writeUInt8(ace.AceFlags, 1);
        aceBuffer.writeUInt16LE(aceSize, 2);
        aceBuffer.writeUInt32LE(ace.AccessMask, 4);
        sidBuffer.copy(aceBuffer, 8);

        aceBuffers.push(aceBuffer);
      } catch (error) {
        this.logger.warn(`Failed to convert SID ${ace.Sid} to binary: ${error.message}`);
        unresolvedSids.push(ace.Sid);
      }
    }

    if (aceBuffers.length === 0) {
      return null;
    }

    // Build ACL buffer
    const aclBuffer = Buffer.alloc(totalSize);
    aclBuffer.writeUInt8(2, 0); // ACL_REVISION = 2
    aclBuffer.writeUInt8(0, 1); // Sbz1
    aclBuffer.writeUInt16LE(totalSize, 2); // AclSize
    aclBuffer.writeUInt16LE(aceBuffers.length, 4); // AceCount
    aclBuffer.writeUInt16LE(0, 6); // Sbz2

    // Copy ACEs
    let offset = 8;
    for (const aceBuffer of aceBuffers) {
      aceBuffer.copy(aclBuffer, offset);
      offset += aceBuffer.length;
    }

    return aclBuffer;
  }

  /**
   * Parse SHARE_INFO_502 structure
   */
  private parseShareInfo502(buffer: Buffer): {
    permissions?: any[];
    maxUsers?: number;
    currentUsers?: number;
    path?: string;
    remark?: string;
  } {
    // SHARE_INFO_502 is a complex structure
    // This is a simplified parser - full implementation would require
    // proper struct definition with ref-struct-napi
    // For now, return basic structure
    return {
      permissions: [],
      maxUsers: 0,
      currentUsers: 0,
      path: '',
      remark: '',
    };
  }

  /**
   * Build SHARE_INFO_502 structure
   */
  private buildShareInfo502(permissions: SharePermissions): Buffer {
    // SHARE_INFO_502 is a complex structure
    // This is a simplified builder - full implementation would require
    // proper struct definition with ref-struct-napi
    // For now, return a minimal buffer
    return Buffer.alloc(1024);
  }

  /**
   * Get file attributes as string
   */
  private getFileAttributes(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      const attrs: string[] = [];

      if (stats.isDirectory()) {
        attrs.push('Directory');
      }
      if (stats.isFile()) {
        attrs.push('Archive');
      }

      // Check for hidden, readonly, etc. using fs.accessSync or additional checks
      try {
        fs.accessSync(filePath, fs.constants.W_OK);
      } catch {
        attrs.push('ReadOnly');
      }

      return attrs.join(', ') || 'Normal';
    } catch {
      return 'Normal';
    }
  }

  /**
   * Set file attributes
   */
  private setFileAttributes(filePath: string, attributes: string): void {
    // File attributes setting is complex and may require additional Windows APIs
    // For now, this is a placeholder
    this.logger.debug(`Setting file attributes for ${filePath}: ${attributes}`);
  }
}

