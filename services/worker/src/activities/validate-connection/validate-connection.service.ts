import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { ProtocolTypes } from 'src/protocols/protocols';
import { ProtocolRouter } from 'src/protocols/routing/protocol-router';
import { ServerType } from 'src/protocols/protocol/protocol.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ValidateConnectionActivity {
  private readonly logger: LoggerService;
  readonly workerId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocolRouter: ProtocolRouter
  ) {
    this.workerId = this.configService.get('worker.workerId');
    this.logger = loggerFactory.create(ValidateConnectionActivity.name);
  }

  async validate(traceId: string, protocolType: string, payload: any, feature: any): Promise<any> {
    this.logger.log(
      `[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${this.workerId}`,
    );
    const response = {
      traceId: traceId,
      status: 'success',
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: this.workerId,
      paths: [],
      protocolVersions: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`,
    };
    try {
      // Determine server type from payload, default to OtherNAS if not specified
      const serverType = payload.serverType || ServerType.OTHER_NAS;
      
      // Get the appropriate protocol implementation based on server type and protocol type
      const protocol: Protocol = this.protocolRouter.getProtocol(serverType, ProtocolTypes[protocolType]);
      
      await protocol.validateConnection(traceId, payload);
      if (feature.enablePreListPath) {
        response.paths = await protocol.listPaths(traceId, payload);
      }
      if (feature.enableVersionFetch) {
        response.protocolVersions = await protocol.getProtocolVersions(traceId, payload);
      }
      // if(protocolType === ProtocolTypes.SMB) {
      //   this.logger.log(`[${traceId}] disconnecting session for SMB`);
      //   const disconnectResponse = await protocol.disconnectSession(traceId, payload);
      //   this.logger.log(`[${traceId}] Disconnect response: ${disconnectResponse}`);
      // }
      this.logger.log(`[${traceId}] Paths: ${response.paths}`);
      return response;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        protocolType: protocolType,
        hostname: payload.hostname,
        workerId: this.workerId,
        paths: [],
        protocolVersions: [],
        message: `Failed to validate connection for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    }
  }
}
