import { Injectable } from '@nestjs/common';
import { Protocol } from '../protocol/protocol';
import { OtherNasNfsProtocol } from '../other-nas/other-nas-nfs.protocol';
import { OtherNasSmbProtocol } from '../other-nas/other-nas-smb.protocol';
import { IsilonNfsProtocol } from '../isilon/isilon-nfs.protocol';
import { IsilonSmbProtocol } from '../isilon/isilon-smb.protocol';

/**
 * ProtocolRouter - Routes protocol requests to vendor-specific implementations
 * 
 * This router replaces the factory pattern with a simple routing mechanism
 * that selects the appropriate protocol class based on:
 * - serverType: 'OtherNAS' | 'DellIsilon'
 * - protocolType: 'NFS' | 'SMB'
 * 
 * Example routing:
 * - OtherNAS + NFS → OtherNasNfsProtocol
 * - OtherNAS + SMB → OtherNasSmbProtocol
 * - DellIsilon + NFS → IsilonNfsProtocol
 * - DellIsilon + SMB → IsilonSmbProtocol
 */
@Injectable()
export class ProtocolRouter {
  private readonly protocolMap: Map<string, Protocol>;

  constructor(
    private readonly otherNasNfsProtocol: OtherNasNfsProtocol,
    private readonly otherNasSmbProtocol: OtherNasSmbProtocol,
    private readonly isilonNfsProtocol: IsilonNfsProtocol,
    private readonly isilonSmbProtocol: IsilonSmbProtocol,
  ) {
    // Initialize the routing map
    this.protocolMap = new Map<string, Protocol>();

    // Register Generic NAS protocols
    this.protocolMap.set('OtherNAS:NFS', this.otherNasNfsProtocol);
    this.protocolMap.set('OtherNAS:SMB', this.otherNasSmbProtocol);

    // Register Dell Isilon protocols
    this.protocolMap.set('DellIsilon:NFS', this.isilonNfsProtocol);
    this.protocolMap.set('DellIsilon:SMB', this.isilonSmbProtocol);
  }

  /**
   * Get the appropriate protocol implementation based on server type and protocol type
   * 
   * @param serverType - The type of storage server ('OtherNAS' | 'DellIsilon')
   * @param protocolType - The protocol to use ('NFS' | 'SMB')
   * @returns Protocol implementation for the specified combination
   * @throws Error if the combination is not supported
   */
  getProtocol(serverType: string, protocolType: string): Protocol {
    const key = `${serverType}:${protocolType}`;
    const protocol = this.protocolMap.get(key);

    if (!protocol) {
      throw new Error(
        `Unsupported protocol combination: serverType="${serverType}", protocolType="${protocolType}". ` +
        `Supported combinations: ${Array.from(this.protocolMap.keys()).join(', ')}`
      );
    }

    return protocol;
  }

  /**
   * Check if a protocol combination is supported
   * 
   * @param serverType - The type of storage server
   * @param protocolType - The protocol to use
   * @returns true if the combination is supported
   */
  isSupported(serverType: string, protocolType: string): boolean {
    const key = `${serverType}:${protocolType}`;
    return this.protocolMap.has(key);
  }

  /**
   * Get all supported protocol combinations
   * 
   * @returns Array of supported combinations in format "serverType:protocolType"
   */
  getSupportedCombinations(): string[] {
    return Array.from(this.protocolMap.keys());
  }
}
