import { Inject, Injectable, Logger } from '@nestjs/common';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ListPathActivity {
  readonly workerId: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.workerId = this.configService.get('worker.workerId');
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
      if(payload.exportPathSource !== 'MANUAL_UPLOAD') {
        const protocol: Protocol = Protocols.getProtocol(ProtocolTypes[protocolType]);
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
