import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

export interface SmartConnectFileServer {
  smartConnectSsip?: string;
  smartConnectDnsZone?: string;
}

/**
 * Abstract base class for storage clients
 * Provides common functionality and defines interface for storage-specific implementations
 */
export abstract class StorageClient {
  
  protected logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }
  
  /**
   * Configure DNS resolver for SmartConnect FQDN resolution
   * @param traceId - Trace ID for logging
   * @param fileServer - FileServer object containing smartConnectSsip and smartConnectDnsZone
   * @returns true if DNS was configured, false if skipped (no SSIP/zone provided)
   */
  abstract configureSmartConnectDns(traceId: string, fileServer: SmartConnectFileServer): Promise<boolean>;
}