import { Injectable } from '@nestjs/common';
import { StorageClient } from './storage-client';
import { IsilonStorageClient } from './isilon/isilon-storage-client';
import { ServerType } from '../constants/enums';


/**
 * Configuration class for storage client connections
 * Contains connection parameters like hostname, port, username, and password
 */
export class ClientConfig {
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  certificate?: string;
  serverType: ServerType;

  /**
   * Default constructor - initializes with empty values
   */
  constructor();
  /**
   * Parameterized constructor - initializes with provided values
   * @param serverType - The type of server (Dell, Other)
   * @param hostname - The hostname or IP address of the storage server
   * @param port - The port number for the connection
   * @param username - The username for authentication
   * @param password - The password for authentication
   * @param certificate - The TLS certificate for secure connections
   */
  constructor(serverType?: ServerType, hostname?: string, port?: number, username?: string, password?: string, certificate?: string);
  constructor(serverType?: ServerType, hostname?: string, port?: number, username?: string, password?: string, certificate?: string) {
    this.serverType = serverType || ServerType.other;
    this.hostname = hostname || '';
    this.port = port || 0;
    this.username = username || '';
    this.password = password || '';
    this.certificate = certificate || '';
  }
}

/**
 * Factory for creating storage client instances based on server type
 * 
 * Usage:
 * ```typescript
 * const config = new ClientConfig('10.192.7.32', '8080', 'admin', 'password');
 * const client = this.storageClientFactory.getClient(ServerType.DELL, config);
 * const certificate = await client.fetchCertificate(host, port);
 * ```
 */
@Injectable()
export class StorageClientFactory {
  constructor(
    private readonly isilonStorageClient: IsilonStorageClient,
  ) {}

  /**
   * Get the appropriate storage client based on server type
   * @param serverType - The type of server (Dell, Other)
   * @param config - Optional client configuration with connection parameters
   * @returns StorageClient instance for the specified server type
   */
  getClient(config: ClientConfig): StorageClient {
    switch (config.serverType) {
      case ServerType.dell:
        // Create new IsilonStorageClient with connection params
        // Uses the injected client's dependencies (loggerFactory, fileServerRepo)
        if (config) {
          return new IsilonStorageClient(
            this.isilonStorageClient['loggerFactory'],
            this.isilonStorageClient['fileServerRepo'],
            {
              hostname: config.hostname,
              port: config.port,
              username: config.username,
              password: config.password,
              certificate: config.certificate,
            },
          );
        }
    }
  }

  /**
   * Get Dell Isilon storage client directly
   * Use this when you specifically need Isilon-only methods like detectIsilonVersion
   */
  getIsilonClient(): IsilonStorageClient {
    return this.isilonStorageClient;
  }
}
