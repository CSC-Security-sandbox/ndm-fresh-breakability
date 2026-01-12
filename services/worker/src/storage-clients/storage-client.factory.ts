import { Inject, Injectable } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { StorageClient } from './storage-client';
import { IsilonStorageClient } from './isilon/isilon-storage-client';
import { ServerType } from 'src/activities/common/enums';

/**
 * Configuration class for storage client connections
 * Contains connection parameters like hostname, port, username, and password
 * Used by config-service for full connection management
 */
export class ClientConfig {
  serverType: ServerType;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  certificate?: string; 

  /**
   * Constructor - initializes with connection parameters
   */

  
constructor(serverType: ServerType, hostname?: string, port?: number, username?: string, password?: string, certificate?: string) {
    this.serverType = serverType || ServerType.other;
    this.hostname = hostname || '';
    this.port = port || 0;
    this.username = username || '';
    this.password = password || '';
    this.certificate = certificate || '';
  }
}


@Injectable()
export class StorageClientFactory {
  constructor(
    @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
  ) {}

  /**
   * Get the appropriate storage client based on server type
   * @param configOrServerType - Either a ClientConfig object or a serverType string/enum
   * @returns StorageClient instance for the specified server type
   */
  getClient(config: ClientConfig): StorageClient {
    const serverType = config.serverType;

    switch (serverType) {
      case ServerType.dell:
        return new IsilonStorageClient(this.loggerFactory, null, {
          hostname: config.hostname,
          port: config.port,
          username: config.username,
          password: config.password,
          certificate: config.certificate,  
        });
      default:
        return null;
    }
  }
}
