
import { WorkersConfig } from 'src/config/app.config';
import Logger from 'src/logger/logging';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { Protocol } from 'src/protocols/protocol/protocol';

export async function validate(
  traceId: string,
  protocolType: string,
  payload: any,
): Promise<any> {
  const logger = Logger.getLogger();
  const workerId = WorkersConfig.get('workerId');
  logger.info(`[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from ${workerId}`,);

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
    response.paths = await protocol.listPaths(traceId, payload);
    response.protocolVersions = await protocol.getProtocolVersions(traceId, payload);
    logger.info(`[${traceId}] Paths: ${response.paths}`);
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
