import { Module } from '@nestjs/common';
import { Protocols } from './protocols';
import { NFSProtocol } from "./nfs/nfs.protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { LoggerModule, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib'; // 👈 Add LoggerFactory

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [Protocols, NFSProtocol, SMBProtocol, LoggerFactory],
  exports: [Protocols],
})

export class ProtocolsModule {}