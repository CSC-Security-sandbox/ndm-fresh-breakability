import { Module } from '@nestjs/common';
import { Protocols } from './protocols';
import { NFSProtocol } from "./nfs/nfs.protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { WindowsPrivilegeService } from './smb/windows-privilege.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkerThreadModule } from 'src/thread/worker.thread.module';

@Module({
  imports: [LoggerModule.forRoot(), WorkerThreadModule],
  providers: [WindowsPrivilegeService, Protocols, NFSProtocol, SMBProtocol],
  exports: [Protocols, NFSProtocol, SMBProtocol],
})

export class ProtocolsModule {}