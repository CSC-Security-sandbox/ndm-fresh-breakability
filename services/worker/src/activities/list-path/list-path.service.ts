import { Inject, Injectable } from '@nestjs/common';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { ConfigService } from '@nestjs/config';
import { ExportPathSource } from './list-path.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { configureSmbAdDns } from 'src/utils/network.utils';

@Injectable()
export class ListPathActivity {
  readonly workerId: string;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.logger = loggerFactory.create(ListPathActivity.name);
  }

  async listPath(traceId: string, protocolType: string, payload: any): Promise<any> {
    this.logger.log(
      `[${traceId}] List Path for ${payload.hostname} of type ${protocolType} from ${this.workerId}`,
    );

    const response = {
      traceId: traceId,
      status: 'success',
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: this.workerId,
      paths: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`,
    };

    try {
      if (protocolType === ProtocolTypes.SMB && payload.adServerIp) {
        await configureSmbAdDns(traceId, payload.adServerIp, this.logger);
      }
      if(payload.exportPathSource !== ExportPathSource.MANUAL_UPLOAD) {
        const protocol: Protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
        response.paths = await protocol.listPaths(traceId, payload);
        return response;
      }
      return response;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        protocolType: protocolType,
        hostname: payload.hostname,
        workerId: this.workerId,
        paths: [],
        message: `Failed to List Path for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    }
  }
}
