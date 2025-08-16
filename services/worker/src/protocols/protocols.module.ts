import { Module } from '@nestjs/common';
import { Protocols } from './protocols';
import { NFSProtocol } from "./nfs/nfs.protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [Protocols, NFSProtocol, SMBProtocol],
  exports: [Protocols],
})

export class ProtocolsModule {}