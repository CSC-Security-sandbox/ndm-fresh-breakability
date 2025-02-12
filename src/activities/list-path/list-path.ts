import { Injectable } from '@nestjs/common';
import { WorkersConfig } from 'src/config/app.config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Logger } from 'src/logger/logger.service';

@Injectable()
export class ListPathActivity {
  constructor(private readonly logger: Logger) {}

  async listPath(traceId: string, protocolType: string, payload: any): Promise<any> {
    const workerId = WorkersConfig.get('workerId');
    this.logger.info(
      `[${traceId}] List Path for ${payload.hostname} of type ${protocolType} from ${workerId}`,
    );

    const response = {
      traceId: traceId,
      status: 'success',
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: workerId,
      paths: [],
      message: `[${protocolType}] Connection to ${payload.hostname} from ${workerId} validated successfully`,
    };

    try {
      const protocol: Protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
      response.paths = await protocol.listPaths(traceId, payload);
      return response;
    } catch (error) {
      return {
        traceId: traceId,
        status: 'error',
        protocolType: protocolType,
        hostname: payload.hostname,
        workerId: workerId,
        paths: [],
        message: `Failed to List Path for ${payload.hostname} of type ${protocolType}: ${error}`,
      };
    }
  }
}
