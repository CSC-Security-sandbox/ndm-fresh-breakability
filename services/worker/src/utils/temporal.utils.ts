import { NativeConnection } from '@temporalio/worker';
import { Connection as ClientConnection } from '@temporalio/client';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { TemporalConnectionConfig, TemporalConfig } from './temporal.types';


/**
 * Build Temporal connection configuration with TLS and JWT settings.
 * 
 * @param config - Configuration for Temporal connection
 * @param logger - Logger instance for logging
 * @returns Temporal connection config object ready for connection
 * @throws Error if JWT authentication required but unavailable
 */
export async function buildTemporalConfig(
  config: TemporalConnectionConfig,
  logger: LoggerService,
): Promise<TemporalConfig> {
  const temporalConfig: TemporalConfig = {
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
    
  }

  return temporalConfig;
}

/**
 * Create a Temporal ClientConnection for client operations.
 * Used to interact with Temporal server (query workflows, start workflows, check status, etc.)
 * 
 * @param temporalConfig - Pre-built temporal config object (with TLS, JWT metadata already set)
 * @param logger - Logger instance for logging
 * @returns ClientConnection instance
 * @throws Error if connection fails
 */
export async function createClientConnection(
  temporalConfig: TemporalConfig,
  logger: LoggerService,
): Promise<ClientConnection> {
  try {
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
 * @param temporalConfig - Pre-built temporal config object (with TLS, JWT metadata already set)
 * @param logger - Logger instance for logging
 * @returns Object containing both native and client connections
 * @throws Error if connection fails
 */
export async function createTemporalConnections(
  temporalConfig: TemporalConfig,
  logger: LoggerService,
): Promise<{ nativeConnection: NativeConnection; clientConnection: ClientConnection }> {
  try {    
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

/**
 * Refresh Temporal connections with a new JWT token.
 * Creates new connections and validates them before returning.
 * 
 * @param oldNativeConnection - Existing NativeConnection to close
 * @param oldClientConnection - Existing ClientConnection to close
 * @param temporalConfig - Pre-built temporal config object (with TLS, JWT metadata already set)
 * @param logger - Logger instance for logging
 * @returns New connection pair with updated expiry timestamp
 */
export async function refreshTemporalConnections(
  oldNativeConnection: NativeConnection | null,
  oldClientConnection: ClientConnection | null,
  temporalConfig: TemporalConfig,
  logger: LoggerService,  
): Promise<{ 
  nativeConnection: NativeConnection; 
  clientConnection: ClientConnection;  
}> {
  logger.log('[refreshTemporalConnections] - Closing old connections');
  
  // Close old client connection
  if (oldClientConnection) {
    try {
      oldClientConnection.close();
      logger.debug('[refreshTemporalConnections] - Old ClientConnection closed');
    } catch (err) {
      logger.debug(`[refreshTemporalConnections] - Error closing old client connection: ${err.message}`);
    }
  }
  
  // Close old native connection
  if (oldNativeConnection) {
    try {
      await oldNativeConnection.close();
      logger.debug('[refreshTemporalConnections] - Old NativeConnection closed');
    } catch (err) {
      logger.debug(`[refreshTemporalConnections] - Error closing old native connection: ${err.message}`);
    }
  }
  
  logger.log('[refreshTemporalConnections] - Creating new connections with fresh token');
  
  // Create new connections with fresh JWT
  const connections = await createTemporalConnections(temporalConfig, logger);
  
  // Validate new connection health
  try {
    logger.debug('[refreshTemporalConnections] - Validating new connection health');
    await connections.clientConnection.workflowService.getSystemInfo({});
    logger.log('[refreshTemporalConnections] - New connection validated successfully');
  } catch (healthErr) {
    logger.error(`[refreshTemporalConnections] - New connection failed validation: ${healthErr.message}`);
    throw new Error(`Connection health check failed: ${healthErr.message}`);
  }
  return {
    nativeConnection: connections.nativeConnection,
    clientConnection: connections.clientConnection,    
  };
}
