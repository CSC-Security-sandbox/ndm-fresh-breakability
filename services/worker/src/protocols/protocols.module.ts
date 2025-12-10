import { Module } from '@nestjs/common';
import { Protocols } from './protocols';
import { NFSProtocol } from "./nfs/nfs.protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { WindowsPrivilegeService } from './smb/windows-privilege.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { RoutingModule } from './routing/routing.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    RoutingModule,  // Import the routing module
  ],
  providers: [WindowsPrivilegeService, Protocols, NFSProtocol, SMBProtocol],
  exports: [
    Protocols, 
    NFSProtocol, 
    SMBProtocol,
    RoutingModule,  // Re-export so other modules can use ProtocolRouter
  ],
})

export class ProtocolsModule {}