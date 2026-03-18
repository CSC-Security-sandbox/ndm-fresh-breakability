import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class ValidateConnectionActivity {
  private readonly logger: LoggerService;
  readonly workerId: string;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly protocols: Protocols
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
      warnings: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`,
    };
    try {
      const protocol: Protocol = this.protocols.getProtocol(ProtocolTypes[protocolType]);
      const validateResult = await protocol.validateConnection(traceId, payload);  // ← capture
      response.warnings = validateResult?.warnings ?? [];
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
      if (protocolType === ProtocolTypes.SMB) {
        try {
          this.logger.log(`[${traceId}] disconnecting session for SMB`);
          const disconnectResponse = await protocol.disconnectSession(traceId, payload);
          this.logger.log(`[${traceId}] Disconnect response: ${disconnectResponse}`);
        } catch (disconnectError) {
          this.logger.warn(`[${traceId}] Failed to disconnect SMB session (non-fatal): ${disconnectError.message}`);
        }
      }
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
