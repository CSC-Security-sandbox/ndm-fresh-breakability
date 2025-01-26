
import { WorkersConfig } from 'src/config/app.config';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Logger } from 'src/logger/logger.service';

export async function listPath(
  traceId: string,
  protocolType: string,
  payload: any,
): Promise<any> {
  const logger = new Logger();
  const workerId = WorkersConfig.get('workerId');
  logger.info(`[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${workerId}`,);

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
      message: `Failed to validate connection for ${payload.hostname} of type ${protocolType}: ${error}`,
    };
  }
}
