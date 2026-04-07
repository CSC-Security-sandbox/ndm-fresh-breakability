import { Module } from '@nestjs/common';
import { Protocols } from './protocols';
import { NFSProtocol } from "./nfs/nfs.protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { WindowsPrivilegeService } from './smb/windows-privilege.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [WindowsPrivilegeService, Protocols, NFSProtocol, SMBProtocol],
  exports: [Protocols, NFSProtocol, SMBProtocol, WindowsPrivilegeService],
})

export class ProtocolsModule {}