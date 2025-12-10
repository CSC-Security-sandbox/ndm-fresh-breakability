import { Inject, Injectable } from '@nestjs/common';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes } from 'src/protocols/protocols';
import { ProtocolRouter } from 'src/protocols/routing/protocol-router';
import { ServerType } from 'src/protocols/protocol/protocol.type';
import { ConfigService } from '@nestjs/config';
import { ExportPathSource } from './list-path.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ListPathActivity {
  readonly workerId: string;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocolRouter: ProtocolRouter
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
      if(payload.exportPathSource !== ExportPathSource.MANUAL_UPLOAD) {
        // Determine server type from payload, default to OtherNAS if not specified
        const serverType = payload.serverType || ServerType.OTHER_NAS;
        
        // Get the appropriate protocol implementation based on server type and protocol type
        const protocol: Protocol = this.protocolRouter.getProtocol(serverType, ProtocolTypes[protocolType]);
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
