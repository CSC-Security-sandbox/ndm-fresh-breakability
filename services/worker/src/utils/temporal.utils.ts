import { NativeConnection } from '@temporalio/worker';
import { Connection as ClientConnection } from '@temporalio/client';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

export interface TemporalConnectionConfig {
  address: string;
  namespace?: string;
  tlsEnabled: boolean;
  tlsServerName?: string;
  tlsCaCert?: string;
  jwtEnabled: boolean;
  getAccessToken?: () => Promise<string>;
}

/**
 * Build Temporal connection configuration with TLS and JWT settings.
 * 
 * @param config - Configuration for Temporal connection
 * @param logger - Logger instance for logging
 * @returns Temporal connection config object ready for connection
 * @throws Error if JWT authentication required but unavailable
 */
async function buildTemporalConfig(
  config: TemporalConnectionConfig,
  logger: LoggerService,
): Promise<any> {
  const temporalConfig: any = {
    address: config.address,
  };

  // Configure TLS if enabled
  if (config.tlsEnabled && config.tlsCaCert) {
    const caCertBuffer = Buffer.from(config.tlsCaCert, 'base64');
    logger.log(`[buildTemporalConfig] - TLS certificate loaded: ${caCertBuffer.length} bytes`);
    
    temporalConfig.tls = {
      serverNameOverride: config.tlsServerName,
      serverRootCACertificate: caCertBuffer,
    };
  }

  if (config.jwtEnabled) {
    logger.log('[buildTemporalConfig] - JWT authentication enabled for Temporal connection');
    
    if (!config.getAccessToken) {
      throw new Error('JWT enabled but no getAccessToken function provided');
    }

    try {
      const accessToken = await config.getAccessToken();
      
      if (!accessToken) {
        throw new Error('Access token is null or undefined');
      }
      
      temporalConfig.metadata = {
        authorization: `Bearer ${accessToken}`,
      };
      
      logger.log('[buildTemporalConfig] - JWT added to Temporal connection metadata');
    } catch (jwtError) {
      logger.error(`Failed to obtain JWT for Temporal connection: ${jwtError}`);
      throw new Error('JWT authentication required but token unavailable');
    }
  }

  return temporalConfig;
}

/**
 * Create a Temporal NativeConnection for Worker usage.
 * Used by Workers to poll and execute tasks from Temporal task queues.
 * 
 * @param config - Configuration for Temporal connection
 * @param logger - Logger instance for logging
 * @returns NativeConnection instance
 * @throws Error if connection fails
 */
export async function createNativeConnection(
  config: TemporalConnectionConfig,
  logger: LoggerService,
): Promise<NativeConnection> {
  try {
    const temporalConfig = await buildTemporalConfig(config, logger);
    const connection = await NativeConnection.connect(temporalConfig);
    logger.log('[createNativeConnection] - NativeConnection established successfully');
    return connection;
  } catch (err) {
    logger.error(`Error creating NativeConnection: ${err}`);
    throw err;
  }
}

/**
 * Create a Temporal ClientConnection for client operations.
 * Used to interact with Temporal server (query workflows, start workflows, check status, etc.)
 * 
 * @param config - Configuration for Temporal connection
 * @param logger - Logger instance for logging
 * @returns ClientConnection instance
 * @throws Error if connection fails
 */
export async function createClientConnection(
  config: TemporalConnectionConfig,
  logger: LoggerService,
): Promise<ClientConnection> {
  try {
    const temporalConfig = await buildTemporalConfig(config, logger);
    const connection = await ClientConnection.connect(temporalConfig);
    logger.log('[createClientConnection] - ClientConnection established successfully');
    return connection;
  } catch (err) {
    logger.error(`Error creating ClientConnection: ${err}`);
    throw err;
  }
}

/**
 * Create both Temporal connections (Native + Client).
 * Use this when you need both worker and client functionality.
 * 
 * Build the Temporal config once (including TLS and JWT) and reuse it for both connections
 * to ensure consistency and avoid fetching JWT token twice.
 * 
 * @param config - Configuration for Temporal connection
 * @param logger - Logger instance for logging
 * @returns Object containing both native and client connections
 * @throws Error if connection fails
 */
export async function createTemporalConnections(
  config: TemporalConnectionConfig,
  logger: LoggerService,
): Promise<{ nativeConnection: NativeConnection; clientConnection: ClientConnection }> {
  try {
    const temporalConfig = await buildTemporalConfig(config, logger);

    const [nativeConnection, clientConnection] = await Promise.all([
      NativeConnection.connect(temporalConfig),
      ClientConnection.connect(temporalConfig),
    ]);

    logger.log('[createTemporalConnections] - Both connections established successfully');

    return { nativeConnection, clientConnection };
  } catch (err) {
    logger.error(`Error creating Temporal connections: ${err}`);
    throw err;
  }
}
