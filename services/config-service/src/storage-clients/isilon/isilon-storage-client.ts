import { BadRequestException, Injectable, InternalServerErrorException, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { StorageClient, SmartConnectFileServer } from '../storage-client';
import { FileServerEntity } from '../../entities/fileserver.entity';
import {
  FetchZonesRequestDTO,
  FetchZonesResponseDTO,
  NFSExportPathDTO,
  SMBShareDTO,
} from '../../configurations/dto/config.dto';
import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

/** Default Isilon Platform API version to use when version detection fails or for latest OneFS versions */
const DEFAULT_ISILON_API_VERSION = 14;

/** Injection token for optional connection parameters */
export const ISILON_CONNECTION_PARAMS = 'ISILON_CONNECTION_PARAMS';

/**
 * Dell Isilon/PowerScale storage client implementation
 * Implements storage-specific operations for Isilon systems
 */
@Injectable()
export class IsilonStorageClient extends StorageClient {
  // Connection properties - can be set via constructor or left empty for per-request credentials
  hostname: string;
  port: number;
  username: string;
  password: string;
  certificate: string;

  constructor(
    private loggerFactory: LoggerFactory,
    @InjectRepository(FileServerEntity)
    private readonly fileServerRepo: Repository<FileServerEntity>,
    @Optional() @Inject(ISILON_CONNECTION_PARAMS) connectionParams?: {
      hostname?: string;
      port?: number;
      username?: string;
      password?: string;
      certificate?: string;
    },
  ) {
    super(loggerFactory.create(IsilonStorageClient.name));
    this.hostname = connectionParams?.hostname || '';
    this.port = connectionParams?.port || 0;
    this.username = connectionParams?.username || '';
    this.password = connectionParams?.password || '';
    this.certificate = connectionParams?.certificate || '';
  }

  /**
   * Detect the installed Isilon/PowerScale OneFS version and determine the appropriate API version
   * Maps OneFS versions to their supported platform API versions based on Dell documentation:
   * https://www.dell.com/support/manuals/en-in/isilon-onefs/ifs_pub_onefs_api_reference/api-versions-in-onefs
   * 
   * OneFS Version -> API Version:
   * - 9.3.0.0+    -> API v14
   * - 9.2.1.0     -> API v13
   * - 9.2.0.0     -> API v12
   * - 9.1.0.0     -> API v11
   * - 9.0.0.0     -> API v10
   * - 8.2.2.x     -> API v9
   * - 8.2.1.x     -> API v8
   * - 8.2.0.x     -> API v7
   * - 8.1.1.x     -> API v6
   * - 8.1.0.x     -> API v5
   * - 8.0.1.x     -> API v4
   * - 8.0.0.x     -> API v3
   * 
   * @returns Object containing OneFS version and API version to use
   */
  async detectIsilonVersion(
    host: string,
    port: number,
    username: string,
    password: string,
    certificate: string,
  ): Promise<{ oneFsVersion: string; apiVersion: number }> {
    try {
      this.logger.log(`Detecting Isilon/PowerScale version at ${host}:${port}`);

      // Call /platform/1/cluster/config to get cluster information including OneFS version
      const clusterConfig = await this.makeIsilonAPICall(
        host,
        port,
        '/platform/1/cluster/config',
        'GET',
        username,
        password,
        certificate,
      );

      const oneFsVersion = clusterConfig?.onefs_version?.release || clusterConfig?.onefs_version?.version || '';
      
      if (!oneFsVersion) {
        this.logger.warn(`Could not determine OneFS version from cluster config, defaulting to API v${DEFAULT_ISILON_API_VERSION}`);
        return { oneFsVersion: 'unknown', apiVersion: DEFAULT_ISILON_API_VERSION };
      }

      this.logger.log(`Detected OneFS version: ${oneFsVersion}`);

      // Parse major, minor, and patch version numbers
      const versionMatch = oneFsVersion.match(/^v?(\d+)\.(\d+)\.(\d+)/i);
      if (!versionMatch) {
        this.logger.warn(`Could not parse OneFS version '${oneFsVersion}', defaulting to API v${DEFAULT_ISILON_API_VERSION}`);
        return { oneFsVersion, apiVersion: DEFAULT_ISILON_API_VERSION };
      }

      const majorVersion = parseInt(versionMatch[1], 10);
      const minorVersion = parseInt(versionMatch[2], 10);
      const patchVersion = parseInt(versionMatch[3], 10);

      // Determine API version based on OneFS version (from Dell documentation)
      let apiVersion: number;

      if (majorVersion >= 10) {
        // Future versions - use latest known API
        apiVersion = DEFAULT_ISILON_API_VERSION;
      } else if (majorVersion === 9) {
        if (minorVersion >= 3) {
          apiVersion = DEFAULT_ISILON_API_VERSION; // 9.3.0.0+
        } else if (minorVersion === 2 && patchVersion >= 1) {
          apiVersion = 13; // 9.2.1.0
        } else if (minorVersion === 2) {
          apiVersion = 12; // 9.2.0.0
        } else if (minorVersion === 1) {
          apiVersion = 11; // 9.1.0.0
        } else {
          apiVersion = 10; // 9.0.0.0
        }
      } else if (majorVersion === 8) {
        if (minorVersion >= 3) {
          apiVersion = 9; // 8.3+ (use latest 8.x API)
        } else if (minorVersion === 2) {
          if (patchVersion >= 2) {
            apiVersion = 9; // 8.2.2.x
          } else if (patchVersion === 1) {
            apiVersion = 8; // 8.2.1.x
          } else {
            apiVersion = 7; // 8.2.0.x
          }
        } else if (minorVersion === 1) {
          if (patchVersion >= 1) {
            apiVersion = 6; // 8.1.1.x
          } else {
            apiVersion = 5; // 8.1.0.x
          }
        } else {
          // minorVersion === 0
          if (patchVersion >= 1) {
            apiVersion = 4; // 8.0.1.x
          } else {
            apiVersion = 3; // 8.0.0.x
          }
        }
      } else {
        // OneFS 7.x or older - use API v3 (earliest documented)
        this.logger.warn(`OneFS version ${majorVersion}.${minorVersion}.${patchVersion} is older than 8.0, using API v3`);
        apiVersion = 3;
      }

      this.logger.log(
        `Using API v${apiVersion} for OneFS ${oneFsVersion}`
      );

      return { oneFsVersion, apiVersion };
    } catch (error) {
      this.logger.error(`Error detecting Isilon version: ${error?.message || 'Unknown error'}`);
      // Default to latest API version if detection fails - most common modern version
      return { oneFsVersion: 'unknown', apiVersion: DEFAULT_ISILON_API_VERSION };
    }
  }

  /**
   * Fetch access zones from Isilon management server
   * Used during initial setup before credentials are stored in DB
   * Fetches zones, their groupnets, subnets, and IP pool ranges
   */
  async fetchZones(): Promise<FetchZonesResponseDTO> {
   // const { host, port , username, password, certificate } = params;
    
    try {
      this.logger.log(`Fetching all zones from ${this.hostname}:${this.port}`);

      // Detect Isilon version and get appropriate API version
      const { oneFsVersion, apiVersion } = await this.detectIsilonVersion(
        this.hostname,
        this.port,
        this.username,
        this.password,
        this.certificate,
      );

      this.logger.log(`Using API v${apiVersion} for zones endpoint (OneFS: ${oneFsVersion})`);

      // 1. Get all zones from /platform/{apiVersion}/zones
      const zonesResponse = await this.makeIsilonAPICall(
        this.hostname,
        this.port,
        `/platform/${apiVersion}/zones`,
        'GET',
        this.username,
        this.password,
        this.certificate,
      );

      const allZones = zonesResponse?.zones || [];

      if (allZones.length === 0) {
        this.logger.warn(`No zones found on ${this.hostname}:${this.port}`);
        return {
          zones: [],
          totalZones: 0,
          totalIpAddresses: 0,
        };
      }

      this.logger.log(`Found ${allZones.length} zones on ${this.hostname}:${this.port}`);

      // 2. For each zone, fetch groupnet and IP addresses
      const zonesWithIpAddresses = [];
      let totalIpAddresses = 0;

      for (const zone of allZones) {
        const zoneName = zone?.name || 'unknown';
        const zoneId = zone?.zone_id || zone?.id || 1; // Numeric zone ID from Isilon API
        const groupnet = zone?.groupnet || '';

        try {
          this.logger.debug(`Processing zone '${zoneName}' (ID: ${zoneId})`);

          if (!groupnet) {
            this.logger.warn(`Zone '${zoneName}' has no groupnet, skipping`);
            zonesWithIpAddresses.push({
              zoneId,
              zoneName,
              ipAddresses: [],
              smartConnectFqdn: null,
              ssip: null,
              scDnsZone: null,
            });
            continue;
          }

          this.logger.debug(`Zone '${zoneName}' is associated with groupnet '${groupnet}'`);

          // Get subnets for the groupnet from /platform/{apiVersion}/network/groupnets/{groupnet}/subnets
          const subnetsResponse = await this.makeIsilonAPICall(
            this.hostname,
            this.port,
            `/platform/${apiVersion}/network/groupnets/${groupnet}/subnets`,
            'GET',
            this.username,
            this.password,
            this.certificate,
          );

          const subnets = subnetsResponse?.subnets || [];

          if (subnets.length === 0) {
            this.logger.debug(`No subnets found for groupnet '${groupnet}' in zone '${zoneName}'`);
            zonesWithIpAddresses.push({
              zoneId,
              zoneName,
              ipAddresses: [],
              smartConnectFqdn: null,
              ssip: null,
            });
            continue;
          }

          // For each subnet, get pools and collect IP addresses from interfaces
          const ipAddresses = [];
          let zoneSmartConnectFqdn: string | null = null;
          let zoneSsip: string | null = null;
          let zoneScDnsZone: string | null = null;

          for (const subnet of subnets) {
            const subnetName = subnet?.name || 'unknown';
            this.logger.debug(`Processing subnet '${subnetName}' in zone '${zoneName}'`);

            try {
              // Get pools from /platform/{apiVersion}/network/groupnets/{groupnet}/subnets/{subnet}/pools/
              const poolsResponse = await this.makeIsilonAPICall(
                this.hostname,
                this.port,
                `/platform/${apiVersion}/network/groupnets/${groupnet}/subnets/${subnetName}/pools`,
                'GET',
                this.username,
                this.password,
                this.certificate,
              );

              const pools = poolsResponse?.pools || [];
              
              // Get SC Service Name from subnet for FQDN construction
              const scServiceName = subnet?.sc_service_name || '';
              // Get SC Service IP (SSIP) from subnet
              const scServiceAddrs = subnet?.sc_service_addrs || [];
              const ssip = scServiceAddrs.length > 0 ? scServiceAddrs[0]?.low : null;

              for (const pool of pools) {
                const poolName = pool?.name || 'unknown';
                const poolAccessZone = pool?.access_zone || '';
                
                // Get SC DNS Zone from pool for FQDN construction
                const scDnsZone = pool?.sc_dns_zone || '';
                
                // Build SmartConnect FQDN if both parts are available
                const smartConnectFqdn = (scServiceName && scDnsZone) 
                  ? `${scServiceName}.${scDnsZone}` 
                  : null;
                
                if (smartConnectFqdn) {
                  this.logger.debug(`Pool '${poolName}' SmartConnect FQDN: ${smartConnectFqdn}, SSIP: ${ssip}`);
                }
                
                // Store SmartConnect info if this pool belongs to current zone
                if (poolAccessZone === zoneName && smartConnectFqdn) {
                  // Store zone-level SmartConnect info
                  zoneSmartConnectFqdn = smartConnectFqdn;
                  zoneSsip = ssip;
                  zoneScDnsZone = scDnsZone || null;
                  
                  // Add SmartConnect FQDN as first IP option (for user selection)
                  if (!ipAddresses.includes(smartConnectFqdn)) {
                    ipAddresses.unshift(smartConnectFqdn);
                  }
                  // Note: SSIP is stored separately for DNS configuration, not shown in IP list
                  // It's used by workers to configure DNS resolver for FQDN resolution
                }
                
                // Only collect IPs from pools that belong to this zone
                if (poolAccessZone !== zoneName) {
                  this.logger.debug(`Skipping pool '${poolName}' - belongs to zone '${poolAccessZone}', not '${zoneName}'`);
                  continue;
                }
                
                try {
                  // Get interfaces (individual IPs) from /platform/{apiVersion}/network/groupnets/{groupnet}/subnets/{subnet}/pools/{pool}/interfaces
                  const interfacesResponse = await this.makeIsilonAPICall(
                    this.hostname,
                    this.port,
                    `/platform/${apiVersion}/network/groupnets/${groupnet}/subnets/${subnetName}/pools/${poolName}/interfaces`,
                    'GET',
                    this.username,
                    this.password,
                    this.certificate,
                  );

                  const interfaces = interfacesResponse?.interfaces || [];
                  
                  // Extract IP addresses from each interface
                  for (const iface of interfaces) {
                    if (iface?.ip_addrs && Array.isArray(iface.ip_addrs)) {
                      iface.ip_addrs.forEach((ip) => {
                        if (ip) {
                          ipAddresses.push(ip);
                        }
                      });
                    }
                  }
                  
                  this.logger.debug(`Found ${interfaces.length} interfaces with ${ipAddresses.length} IPs in pool '${poolName}' for zone '${zoneName}'`);
                } catch (poolError) {
                  this.logger.warn(
                    `Failed to fetch interfaces for pool '${poolName}' in zone '${zoneName}': ${poolError?.message || 'Unknown error'}`
                  );
                }
              }
            } catch (subnetError) {
              this.logger.warn(
                `Failed to fetch pools for subnet '${subnetName}' in zone '${zoneName}': ${subnetError?.message || 'Unknown error'}`
              );
            }
          }

          totalIpAddresses += ipAddresses.length;
          zonesWithIpAddresses.push({
            zoneId,
            zoneName,
            ipAddresses,
            smartConnectFqdn: zoneSmartConnectFqdn,
            ssip: zoneSsip,
            scDnsZone: zoneScDnsZone,
          });

          this.logger.debug(`Found ${ipAddresses.length} IP addresses for zone '${zoneName}'${zoneSmartConnectFqdn ? `, SmartConnect: ${zoneSmartConnectFqdn}` : ''}`);
        } catch (zoneError) {
          this.logger.warn(
            `Failed to process zone '${zoneName}': ${zoneError?.message || 'Unknown error'}`
          );
          // Continue with next zone even if one fails
          zonesWithIpAddresses.push({
            zoneId,
            zoneName,
            ipAddresses: [],
            smartConnectFqdn: null,
            ssip: null,
            scDnsZone: null,
          });
        }
      }

      this.logger.log(
        `Successfully fetched ${totalIpAddresses} IP addresses across ${zonesWithIpAddresses.length} zones from ${this.hostname}:${this.port}`
      );

      return {
        zones: zonesWithIpAddresses,
        totalZones: zonesWithIpAddresses.length,
        totalIpAddresses,
      };
    } catch (error) {
      this.logger.error(`Error fetching zones and IP ranges: ${error?.message || 'Unknown error'}`);
      
      // Provide specific error messages based on error type
      if (error.message?.includes('ECONNREFUSED')) {
        throw new BadRequestException(
          `Connection refused to ${this.hostname}:${this.port}. Please verify the host and port are correct.`
        );
      } else if (error.message?.includes('timeout')) {
        throw new BadRequestException(
          `Connection timeout to ${this.hostname}:${this.port}. Please verify the host is reachable.`
        );
      } else if (error.message?.includes('certificate') || error.message?.includes('SSL') || error.message?.includes('self-signed')) {
        throw new BadRequestException(
          `TLS certificate verification failed for ${this.hostname}:${this.port}. Certificate error: ${error.message}`
        );
      }

      throw new InternalServerErrorException(
        `Failed to connect to Isilon/PowerScale at ${this.hostname}:${this.port}: ${error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Get NFS export paths for a file server
   * Fetches credentials from DB and calls Isilon API with zone query parameter
   * API: GET /platform/3/protocols/nfs/exports?zone=<zoneName>
   */
  async getNFSExportPaths(fileServerId: string): Promise<NFSExportPathDTO[]> {
    try {
      this.logger.log(`Fetching NFS export paths for file server ${fileServerId}`);

      // Fetch file server with config relationship to get management credentials
      const fileServer = await this.fileServerRepo.findOne({
        where: { id: fileServerId },
        relations: ['config'],
      });

      if (!fileServer) {
        throw new Error(`File server ${fileServerId} not found`);
      }

      if (!fileServer.config) {
        throw new Error(`Config not found for file server ${fileServerId}`);
      }

      const { config } = fileServer;


      const zoneName = fileServer.fileServerName;

      if (!zoneName) {
        this.logger.warn(`File server ${fileServerId} has no fileServerName (zone name), cannot filter exports`);
        return [];
      }

      this.logger.debug(`Fetching NFS exports for zone '${zoneName}' from ${config.hostname}:${config.port}`);

      // Call Isilon API: GET /platform/3/protocols/nfs/exports?zone=<zoneName>
      // Pass zone as query parameter to get only exports for this specific zone
      const exportsResponse = await this.makeIsilonAPICall(
        this.hostname,
        this.port,
        `/platform/3/protocols/nfs/exports?zone=${encodeURIComponent(zoneName)}`,
        'GET',
        this.username,
        this.password,
        this.certificate,
      );

      const zoneExports = exportsResponse?.exports || [];
      this.logger.log(`Found ${zoneExports.length} NFS exports for zone '${zoneName}'`);

      // Extract export paths - flatten all paths from each export
      // Isilon exports can have multiple paths per export (e.g., /ifs/volume and /ifs/volume/ndm)
      const exportPaths: NFSExportPathDTO[] = [];
      for (const exp of zoneExports) {
        if (exp?.paths && Array.isArray(exp.paths)) {
          for (const path of exp.paths) {
            exportPaths.push({
              path: path,
              id: exp.id,
            });
          }
        }
      }

      this.logger.log(`Returning ${exportPaths.length} NFS export paths for file server ${fileServerId}`);
      return exportPaths;
    } catch (error) {
      this.logger.error(`Error fetching NFS exports for file server ${fileServerId}: ${error?.message || 'Unknown error'}`);
      throw new InternalServerErrorException(
        `Failed to fetch NFS exports: ${error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Get SMB shares for a file server
   * Fetches credentials from DB and calls Isilon API with zone query parameter
   * API: GET /platform/3/protocols/smb/shares?zone=<zoneName>
   */
  async getSMBShares(fileServerId: string): Promise<SMBShareDTO[]> {
    try {
      this.logger.log(`Fetching SMB shares for file server ${fileServerId}`);

      // Fetch file server with config relationship to get management credentials
      const fileServer = await this.fileServerRepo.findOne({
        where: { id: fileServerId },
        relations: ['config'],
      });

      if (!fileServer) {
        throw new Error(`File server ${fileServerId} not found`);
      }

      if (!fileServer.config) {
        throw new Error(`Config not found for file server ${fileServerId}`);
      }

      const { config } = fileServer;
      const zoneName = fileServer.fileServerName;

      if (!zoneName) {
        this.logger.warn(`File server ${fileServerId} has no fileServerName (zone name), cannot filter shares`);
        return [];
      }

      this.logger.debug(`Fetching SMB shares for zone '${zoneName}' from ${config.hostname}:${config.port}`);

      // Call Isilon API: GET /platform/3/protocols/smb/shares?zone=<zoneName>
      // Pass zone as query parameter to get only shares for this specific zone
      const sharesResponse = await this.makeIsilonAPICall(
        this.hostname,
        this.port,
        `/platform/3/protocols/smb/shares?zone=${encodeURIComponent(zoneName)}`,
        'GET',
        this.username,
        this.password,
        this.certificate,
      );

      const zoneShares = sharesResponse?.shares || [];
      this.logger.log(`Found ${zoneShares.length} SMB shares for zone '${zoneName}'`);

      // Extract share names and paths
      const shares: SMBShareDTO[] = zoneShares
        .filter(share => share?.name && share?.path)
        .map(share => ({
          name: share.name,
          path: share.path,
        }));

      this.logger.log(`Returning ${shares.length} SMB shares for file server ${fileServerId}`);
      return shares;
    } catch (error) {
      this.logger.error(`Error fetching SMB shares for file server ${fileServerId}: ${error?.message || 'Unknown error'}`);
      throw new InternalServerErrorException(
        `Failed to fetch SMB shares: ${error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Validate connection to Isilon
   * Tests connectivity using provided credentials
   * Makes a simple API call to /platform/1/cluster/config to verify access
   */
  async validateConnection(): Promise<boolean> {
    try {
      this.logger.log(`Validating connection to Isilon at ${this.hostname}:${this.port}`);
      
      // Make a simple API call to verify connectivity
      // Using /platform/1/cluster/config as it's a basic read-only endpoint
      const response = await this.makeIsilonAPICall(
        this.hostname,
        this.port,
        '/platform/1/cluster/config',
        'GET',
        this.username,
        this.password,
        this.certificate,
      );
      
      if (response && response.name) {
        this.logger.log(`Successfully validated connection to Isilon cluster: ${response.name}`);
        return true;
      }
      
      this.logger.warn(`Connection validation failed: Invalid response from Isilon`);
      return false;
    } catch (error) {
      this.logger.error(`Connection validation failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Generic method to make HTTPS API calls to Isilon
   * Handles authentication, SSL certificates, and error handling
   * @private
   */
  private async makeIsilonAPICall(
    host: string,
    port: number,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    username: string,
    password: string,
    certificate: string,
    body?: any,
    queryParams?: Record<string, any>,
  ): Promise<any> {
    const https = await import('https');
    const url = await import('url');
    
    // Build URL with query parameters
    const queryString = queryParams 
      ? '?' + Object.entries(queryParams)
          .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
          .join('&')
      : '';
    
    const fullPath = `${path}${queryString}`;
    
    // Create Basic Auth header
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    // Ensure certificate is in proper PEM format
    const pemCert = certificate.includes('-----BEGIN CERTIFICATE-----')
      ? certificate
      : `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`;

    const options: any = {
      hostname: host,
      port: port,
      path: fullPath,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ca: pemCert,
      rejectUnauthorized: true,
      servername: host,
      // Allow IP address connections (skip hostname verification for self-signed certs)
      checkServerIdentity: () => undefined,
    };
    
    this.logger.debug(`Making ${method} request to ${host}:${port}${fullPath} with SSL verification enabled`);
    
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (error) {
              this.logger.error(`Failed to parse Isilon API response: ${error.message}`);
              reject(new Error(`Invalid JSON response from Isilon API`));
            }
          } else {
            this.logger.error(`Isilon API returned status ${res.statusCode}: ${data}`);
            reject(new Error(`Isilon API error: ${res.statusCode} - ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        this.logger.error(`Isilon API request failed: ${error.message}`);
        reject(error);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Isilon API request timeout'));
      });
      
      // Send body if present
      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }

  /**
   * Configure DNS resolver for Dell Isilon SmartConnect FQDN resolution
   * Adds the SmartConnect SSIP as a nameserver for the SmartConnect DNS zone
   * Supports Linux, macOS, and Windows
   * 
   * @param traceId - Trace ID for logging
   * @param fileServer - FileServer object containing smartConnectSsip and smartConnectDnsZone
   * @returns true if DNS was configured, false if skipped (no SSIP/zone provided)
   */
  async configureSmartConnectDns(
    traceId: string,
    fileServer: SmartConnectFileServer
  ): Promise<boolean> {
    const { smartConnectSsip: ssip, smartConnectDnsZone: dnsZone } = fileServer;

    if (!ssip || !dnsZone) {
      return false;
    }

    this.logger.log(`[${traceId}] Configuring SmartConnect DNS: SSIP=${ssip}, Zone=${dnsZone}, Platform=${process.platform}`);

    try {
      switch (process.platform) {
        case 'linux':
          await this.configureLinuxDns(traceId, ssip, dnsZone);
          break;
        case 'darwin':
          await this.configureMacOSDns(traceId, ssip, dnsZone);
          break;
        case 'win32':
          await this.configureWindowsDns(traceId, ssip, dnsZone);
          break;
        default:
          throw new Error(`Unsupported platform for DNS configuration: ${process.platform}`);
      }
      return true;
    } catch (error) {
      this.logger.error(`[${traceId}] Failed to configure SmartConnect DNS: ${error.message}`);
      throw error;
    }
  }

  private async configureLinuxDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    const resolvConfPath = '/etc/resolv.conf';
    const nameserverEntry = `nameserver ${ssip}`;

    const currentContent = await this.readFileOrEmpty(resolvConfPath, traceId);

    if (currentContent.includes(nameserverEntry)) {
      this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured`);
      return;
    }

    const newContent = this.buildResolvConf(currentContent, ssip, dnsZone);
    await fsPromises.writeFile(resolvConfPath, newContent);

    this.logger.log(`[${traceId}] Linux: SmartConnect DNS configured successfully`);
  }

  private async configureMacOSDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    const resolverDir = '/etc/resolver';
    const resolverFile = path.join(resolverDir, dnsZone);

    try {
      const content = await fsPromises.readFile(resolverFile, 'utf-8');
      if (content.includes(ssip)) {
        this.logger.log(`[${traceId}] SmartConnect SSIP ${ssip} already configured for ${dnsZone}`);
        return;
      }
    } catch {
      this.logger.log(`[${traceId}] Resolver file not found for ${dnsZone}, creating new one`);
    }

    await fsPromises.mkdir(resolverDir, { recursive: true });
    const resolverContent = `# SmartConnect DNS resolver for Dell Isilon\nnameserver ${ssip}\n`;
    await fsPromises.writeFile(resolverFile, resolverContent);

    this.logger.log(`[${traceId}] macOS: SmartConnect DNS configured at ${resolverFile}`);
  }

  private async configureWindowsDns(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<void> {
    if (await this.isWindowsDnsConfigured(traceId, ssip, dnsZone)) {
      return;
    }

    const addCmd = `powershell -Command "Add-DnsClientNrptRule -Namespace '.${dnsZone}' -NameServers '${ssip}'"`;

    try {
      await execAsync(addCmd);
      this.logger.log(`[${traceId}] Windows: SmartConnect DNS NRPT rule added for ${dnsZone} -> ${ssip}`);
    } catch (addError) {
      this.logger.warn(`[${traceId}] Failed to add NRPT rule: ${addError.message}. Trying netsh fallback...`);
      await this.configureWindowsDnsViaNetsh(traceId, ssip);
    }
  }

  private async isWindowsDnsConfigured(
    traceId: string,
    ssip: string,
    dnsZone: string
  ): Promise<boolean> {
    const checkCmd = `powershell -Command "Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq '.${dnsZone}' }"`;

    try {
      const { stdout } = await execAsync(checkCmd);
      if (stdout && stdout.trim()) {
        this.logger.log(`[${traceId}] SmartConnect DNS rule already exists for ${dnsZone}`);
        return true;
      }
    } catch (checkError) {
      this.logger.warn(`[${traceId}] PowerShell NRPT check failed: ${checkError.message}. Trying nslookup fallback...`);

      try {
        const { stdout: nslookupOut } = await execAsync(`nslookup ${dnsZone} ${ssip}`);
        if (nslookupOut && !nslookupOut.includes("can't find") && !nslookupOut.includes('NXDOMAIN')) {
          this.logger.log(`[${traceId}] SmartConnect DNS zone ${dnsZone} already resolves via ${ssip}`);
          return true;
        }
      } catch {
        this.logger.log(`[${traceId}] SmartConnect DNS rule not found for ${dnsZone}, creating new rule`);
      }
    }

    return false;
  }

  private async configureWindowsDnsViaNetsh(
    traceId: string,
    ssip: string
  ): Promise<void> {
    const netshCmd = `netsh interface ip add dns name="Ethernet" addr=${ssip} index=1`;

    try {
      await execAsync(netshCmd);
      this.logger.log(`[${traceId}] Windows: SmartConnect DNS added via netsh`);
    } catch (netshError) {
      throw new Error(`Could not configure DNS: ${netshError.message}`);
    }
  }

  private async readFileOrEmpty(
    filePath: string,
    traceId: string
  ): Promise<string> {
    try {
      return await fsPromises.readFile(filePath, 'utf-8');
    } catch {
      this.logger.warn(`[${traceId}] Could not read ${filePath}, will create new file`);
      return '';
    }
  }

  private buildResolvConf(currentContent: string, ssip: string, dnsZone: string): string {
    const lines = currentContent.split('\n').filter(line => line.trim());
    const result: string[] = [`nameserver ${ssip}`];
    let hasSearchLine = false;

    for (const line of lines) {
      if (line.startsWith('search ')) {
        result.push(line.includes(dnsZone) ? line : `${line} ${dnsZone}`);
        hasSearchLine = true;
      } else {
        result.push(line);
      }
    }

    if (!hasSearchLine) {
      result.push(`search ${dnsZone}`);
    }

    return result.join('\n') + '\n';
  }
}
