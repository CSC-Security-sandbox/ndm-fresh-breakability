import { Module } from '@nestjs/common';
import { ProtocolRouter } from './protocol-router';
import { OtherNasNfsProtocol } from '../other-nas/other-nas-nfs.protocol';
import { OtherNasSmbProtocol } from '../other-nas/other-nas-smb.protocol';
import { IsilonNfsProtocol } from '../isilon/isilon-nfs.protocol';
import { IsilonSmbProtocol } from '../isilon/isilon-smb.protocol';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { WindowsPrivilegeService } from '../smb/windows-privilege.service';

/**
 * RoutingModule - Provides protocol routing infrastructure
 * 
 * This module exports the ProtocolRouter which can be injected
 * into activities/services that need to work with storage protocols.
 * 
 * The router handles vendor-specific protocol selection based on
 * serverType and protocolType.
 */
@Module({
  imports: [LoggerModule.forRoot()],  // Use forRoot() to provide LoggerFactory
  providers: [
    // Protocol implementations
    OtherNasNfsProtocol,
    OtherNasSmbProtocol,
    IsilonNfsProtocol,
    IsilonSmbProtocol,
    
    // Router
    ProtocolRouter,
    
    // Windows-specific services (optional)
    WindowsPrivilegeService,
  ],
  exports: [
    ProtocolRouter,
    OtherNasNfsProtocol,
    OtherNasSmbProtocol,
    IsilonNfsProtocol,
    IsilonSmbProtocol,
  ],
})
export class RoutingModule {}
