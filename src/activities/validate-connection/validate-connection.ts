import { Injectable } from '@nestjs/common';
import { WorkersConfig } from 'src/config/app.config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Logger } from 'src/logger/logger.service';

@Injectable()
export class ValidateConnectionService {
  constructor(
    private readonly logger: Logger,
  ) {}

  async validate(traceId: string, protocolType: string, payload: any, feature: any): Promise<any> {
    const workerId = WorkersConfig.get('workerId');
    this.logger.info(
      `[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${workerId}`,
    );

    const response = {
      traceId: traceId,
      status: 'success',
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: workerId,
      paths: [],
      protocolVersions: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${workerId} validated successfully`,
    };

    try {
      const protocol: Protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      await protocol.validateConnection(traceId, payload);
      if (feature.enablePreListPath) {
        response.paths = await protocol.listPaths(traceId, payload);
      }
      if (feature.enableVersionFetch) {
        response.protocolVersions = await protocol.getProtocolVersions(traceId, payload);
      }
      this.logger.info(`[${traceId}] Paths: ${response.paths}`);
      return response;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        protocolType: protocolType,
        hostname: payload.hostname,
        workerId: workerId,
        paths: [],
        protocolVersions: [],
        message: `Failed to validate connection for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    }
  }
}
