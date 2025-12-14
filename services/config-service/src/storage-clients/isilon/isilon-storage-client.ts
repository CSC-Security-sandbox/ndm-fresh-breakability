import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { StorageClient } from '../storage-client';
import { FileServerEntity } from '../../entities/fileserver.entity';
import { ManagementServerEntity } from '../../entities/ManagementServerEntity';
import {
  FetchZonesRequestDTO,
  FetchZonesResponseDTO,
  NFSExportPathDTO,
  SMBShareDTO,
} from '../../configurations/dto/config.dto';

/**
 * Dell Isilon/PowerScale storage client implementation
 * Implements storage-specific operations for Isilon systems
 */
@Injectable()
export class IsilonStorageClient extends StorageClient {
  constructor(
    private loggerFactory: LoggerFactory,
    @InjectRepository(FileServerEntity)
    private readonly fileServerRepo: Repository<FileServerEntity>,
    @InjectRepository(ManagementServerEntity)
    private readonly managementServerRepo: Repository<ManagementServerEntity>,
  ) {
    super(loggerFactory.create(IsilonStorageClient.name));
  }

  /**
   * Fetch access zones from Isilon management server
   * Used during initial setup before credentials are stored in DB
   * Fetches zones, their groupnets, subnets, and IP pool ranges
   */
  async fetchZones(params: FetchZonesRequestDTO): Promise<FetchZonesResponseDTO> {
    const { host, port = 8080, username, password, certificate } = params;
    
    try {
      this.logger.log(`Fetching all zones from ${host}:${port}`);

      // 1. Get all zones from /platform/7/zones
      const zonesResponse = await this.makeIsilonAPICall(
        host,
        port,
        '/platform/7/zones',
        'GET',
        username,
        password,
        certificate,
      );

      const allZones = zonesResponse?.zones || [];

      if (allZones.length === 0) {
        this.logger.warn(`No zones found on ${host}:${port}`);
        return {
          zones: [],
          totalZones: 0,
          totalIpRanges: 0,
        };
      }

      this.logger.log(`Found ${allZones.length} zones on ${host}:${port}`);

      // 2. For each zone, fetch groupnet and IP ranges
      const zonesWithIpRanges = [];
      let totalIpRanges = 0;

      for (const zone of allZones) {
        const zoneName = zone?.name || 'unknown';
        const groupnet = zone?.groupnet || '';

        try {
          this.logger.debug(`Processing zone '${zoneName}'`);

          if (!groupnet) {
            this.logger.warn(`Zone '${zoneName}' has no groupnet, skipping`);
            zonesWithIpRanges.push({
              zoneName,
              groupnet: '',
              ipRanges: [],
            });
            continue;
          }

          this.logger.debug(`Zone '${zoneName}' is associated with groupnet '${groupnet}'`);

          // Get subnets for the groupnet from /platform/7/network/groupnets/{groupnet}/subnets
          const subnetsResponse = await this.makeIsilonAPICall(
            host,
            port,
            `/platform/7/network/groupnets/${groupnet}/subnets`,
            'GET',
            username,
            password,
            certificate,
          );

          const subnets = subnetsResponse?.subnets || [];

          if (subnets.length === 0) {
            this.logger.debug(`No subnets found for groupnet '${groupnet}' in zone '${zoneName}'`);
            zonesWithIpRanges.push({
              zoneName,
              groupnet,
              ipRanges: [],
            });
            continue;
          }

          // For each subnet, get pools and collect IP ranges
          const ipRanges = [];

          for (const subnet of subnets) {
            const subnetName = subnet?.name || 'unknown';
            this.logger.debug(`Processing subnet '${subnetName}' in zone '${zoneName}'`);

            try {
              // Get pools from /platform/7/network/groupnets/{groupnet}/subnets/{subnet}/pools/
              const poolsResponse = await this.makeIsilonAPICall(
                host,
                port,
                `/platform/7/network/groupnets/${groupnet}/subnets/${subnetName}/pools`,
                'GET',
                username,
                password,
                certificate,
              );

              const pools = poolsResponse?.pools || [];

              for (const pool of pools) {
                if (pool?.ranges && Array.isArray(pool.ranges) && pool.ranges.length > 0) {
                  pool.ranges.forEach((range) => {
                    if (range?.low && range?.high) {
                      ipRanges.push({
                        poolName: pool.name || 'unknown',
                        subnet: subnetName,
                        low: range.low,
                        high: range.high,
                      });
                    }
                  });
                }
              }
            } catch (subnetError) {
              this.logger.warn(
                `Failed to fetch pools for subnet '${subnetName}' in zone '${zoneName}': ${subnetError?.message || 'Unknown error'}`
              );
            }
          }

          totalIpRanges += ipRanges.length;
          zonesWithIpRanges.push({
            zoneName,
            groupnet,
            ipRanges,
          });

          this.logger.debug(`Found ${ipRanges.length} IP ranges for zone '${zoneName}'`);
        } catch (zoneError) {
          this.logger.warn(
            `Failed to process zone '${zoneName}': ${zoneError?.message || 'Unknown error'}`
          );
          // Continue with next zone even if one fails
          zonesWithIpRanges.push({
            zoneName,
            groupnet,
            ipRanges: [],
          });
        }
      }

      this.logger.log(
        `Successfully fetched ${totalIpRanges} IP ranges across ${zonesWithIpRanges.length} zones from ${host}:${port}`
      );

      return {
        zones: zonesWithIpRanges,
        totalZones: zonesWithIpRanges.length,
        totalIpRanges,
      };
    } catch (error) {
      this.logger.error(`Error fetching zones and IP ranges: ${error?.message || 'Unknown error'}`);
      
      // Provide specific error messages based on error type
      if (error.message?.includes('ECONNREFUSED')) {
        throw new BadRequestException(
          `Connection refused to ${host}:${port}. Please verify the host and port are correct.`
        );
      } else if (error.message?.includes('timeout')) {
        throw new BadRequestException(
          `Connection timeout to ${host}:${port}. Please verify the host is reachable.`
        );
      } else if (error.message?.includes('certificate') || error.message?.includes('SSL') || error.message?.includes('self-signed')) {
        throw new BadRequestException(
          `TLS certificate verification failed for ${host}:${port}. Certificate error: ${error.message}`
        );
      }

      throw new InternalServerErrorException(
        `Failed to connect to Isilon/PowerScale at ${host}:${port}: ${error?.message || 'Unknown error'}`
      );
    }
  }

  /**
   * Get NFS export paths for a file server
   * Fetches credentials from DB and calls Isilon API
   * TODO: Implement Isilon API integration
   */
  async getNFSExportPaths(fileServerId: string): Promise<NFSExportPathDTO[]> {
    // TODO: Implement
    throw new Error('Method not implemented yet');
  }

  /**
   * Get SMB shares for a file server
   * Fetches credentials from DB and calls Isilon API
   * TODO: Implement Isilon API integration
   */
  async getSMBShares(fileServerId: string): Promise<SMBShareDTO[]> {
    // TODO: Implement
    throw new Error('Method not implemented yet');
  }

  /**
   * Validate connection to Isilon
   * Tests connectivity using provided credentials
   * Makes a simple API call to /platform/1/cluster/config to verify access
   */
  async validateConnection(params: FetchZonesRequestDTO): Promise<boolean> {
    const { host, port = 8080, username, password, certificate } = params;
    
    try {
      this.logger.log(`Validating connection to Isilon at ${host}:${port}`);
      
      // Make a simple API call to verify connectivity
      // Using /platform/1/cluster/config as it's a basic read-only endpoint
      const response = await this.makeIsilonAPICall(
        host,
        port,
        '/platform/1/cluster/config',
        'GET',
        username,
        password,
        certificate,
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
}
