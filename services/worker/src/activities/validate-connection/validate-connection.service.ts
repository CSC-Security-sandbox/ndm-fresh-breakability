import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import {
  CreatApiResponse,
  RESPONSESTATUS,
} from '../../utils/response-handler/create-api-response';
import { ApiResponse } from '../../utils/response-handler/response.interface';

@Injectable()
export class ValidateConnectionActivity {
  readonly workerId: string;
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.workerId = this.configService.get('worker.workerId');
  }

  async validate(
    traceId: string,
    protocolType: string,
    payload: any,
    feature: any,
  ): Promise<any> {
    this.logger.log(
      `[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${this.workerId}`,
    );
    const response = {
      traceId: traceId,
      protocolType: protocolType,
      hostname: payload.hostname,
      workerId: this.workerId,
      paths: [],
      protocolVersions: [],
      message: ``,
      status: '',
    };

    try {
      const protocol: Protocol = Protocols.getProtocol(
        ProtocolTypes[protocolType],
      );
      await protocol.validateConnection(traceId, payload);
      console.log('call inisidethe validateConnection', feature);
      if (feature.enablePreListPath) {
        response.paths = await protocol.listPaths(traceId, payload);
      }
      if (feature.enableVersionFetch) {
        response.protocolVersions = await protocol.getProtocolVersions(
          traceId,
          payload,
        );
      }
      // if(protocolType === ProtocolTypes.SMB) {
      //   this.logger.log(`[${traceId}] disconnecting session for SMB`);
      //   const disconnectResponse = await protocol.disconnectSession(traceId, payload);
      //   this.logger.log(`[${traceId}] Disconnect response: ${disconnectResponse}`);
      // }
      response.status = RESPONSESTATUS.SUCCESS;
      response.message = `[${protocolType}] Connection to ${payload.hostname} from ${this.workerId} validated successfully`;
      this.logger.log(`[${traceId}] Paths: ${response.paths}`);
      const result: ApiResponse<any> = CreatApiResponse.apiResponse(
        RESPONSESTATUS.SUCCESS,
        response,
      );
      return result;
    } catch (error) {
      response.status = RESPONSESTATUS.ERROR;
      response.message = error;
      console.log('call inisidethe Exception nn', error);
      const result: ApiResponse<any> = CreatApiResponse.apiResponse(
        RESPONSESTATUS.ERROR,
        response,
      );
      console.log('CreatApiResponse.apiResponse(response);', result);

      return result;
      // return CreatApiResponse.apiResponse(response);
    }
  }
}
