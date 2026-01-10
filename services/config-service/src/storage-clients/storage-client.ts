import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as tls from 'tls';
import { FetchCertificateResponseDTO } from '../configurations/dto/config.dto';

/**
 * Abstract base class for storage clients
 * Provides common functionality and defines interface for storage-specific implementations
 */
export abstract class StorageClient {
  abstract hostname: string;
  abstract port: number;
  abstract username: string;
  abstract password: string;
  
  protected logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  // ==========================================
  // Abstract methods to be implemented by child classes
  // ==========================================

  /**
   * Fetch zones/file servers from the storage system
   * Used during initial setup before credentials are stored in DB
   * @param params - Storage-specific parameters (varies by implementation)
   */
  abstract fetchZones(): Promise<any>;

  /**
   * Get NFS export paths for a file server
   * Fetches credentials from DB using fileServerId
   * @param fileServerId - UUID of the file server
   */
  abstract getNFSExportPaths(fileServerId: string): Promise<any[]>;

  /**
   * Get SMB shares for a file server
   * Fetches credentials from DB using fileServerId
   * @param fileServerId - UUID of the file server
   */
  abstract getSMBShares(fileServerId: string): Promise<any[]>;

  /**
   * Validate connection to the storage system
   * Fetches credentials from DB using fileServerId
   * @param fileServerId - UUID of the file server
   */
  abstract validateConnection(): Promise<boolean>;

  // ==========================================
  // Concrete methods - Common implementation for all storage types
  // ==========================================

  /**
   * Fetch TLS certificate from a storage server
   * Common implementation for all storage types
   */
  async fetchCertificate(host: string, port?: number): Promise<FetchCertificateResponseDTO> {
    const { host: resolvedHost, port: resolvedPort } = this.parseHostString(host, port);

    this.logger.log(`Fetching TLS certificate from ${resolvedHost}:${resolvedPort}`);

    return new Promise((resolve, reject) => {
      const options: tls.ConnectionOptions = {
        host: resolvedHost,
        port: resolvedPort,
        servername: resolvedHost, // SNI (Server Name Indication)
        rejectUnauthorized: false, // Accept self-signed certificates
      };

      const socket = tls.connect(options, () => {
        try {
          const cert = socket.getPeerCertificate(true);

          if (!cert || Object.keys(cert).length === 0) {
            socket.destroy();
            reject(new BadRequestException({
              message: `No certificate received from ${resolvedHost}:${resolvedPort}`,
              host,
              resolvedHost,
              resolvedPort,
            }));
            return;
          }

          // Calculate dates
          const validFrom = new Date(cert.valid_from);
          const validTo = new Date(cert.valid_to);
          const now = new Date();
          const daysRemaining = Math.floor((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const isExpired = now > validTo;

          // Check if self-signed (subject === issuer)
          const isSelfSigned = (
            cert.subject?.CN === cert.issuer?.CN &&
            cert.subject?.O === cert.issuer?.O
          ) || !cert.issuerCertificate || cert === cert.issuerCertificate;

          // Parse subject alt names
          const subjectAltNames = cert.subjectaltname?.split(', ') || [];

          // Extract issuer chain
          const issuerChain = this.extractIssuerChain(cert);

          // ==========================================
          // Validation Checks
          // ==========================================

          // Check 1: Certificate should not be expired
          if (isExpired) {
            socket.destroy();
            reject(new BadRequestException({
              message: `Certificate from ${resolvedHost}:${resolvedPort} has expired on ${validTo.toISOString()}`,
              host,
              resolvedHost,
              resolvedPort,
              validTo: validTo.toISOString(),
              isExpired: true,
            }));
            return;
          }

          // Check 2: Verify certificate host matches the requested host
          const certHosts: string[] = [];
          
          // Add Common Name (CN) to list of valid hosts
          if (cert.subject?.CN) {
            certHosts.push(cert.subject.CN.toLowerCase());
          }
          
          // Add Subject Alternative Names (SANs) - these are more reliable than CN
          subjectAltNames.forEach((san: string) => {
            // SANs come in format "DNS:hostname" or "IP Address:x.x.x.x"
            const sanValue = san.replace(/^(DNS:|IP Address:)/i, '').trim().toLowerCase();
            if (sanValue) {
              certHosts.push(sanValue);
            }
          });

          // Check if requested host matches any certificate host (including wildcard matching)
          const requestedHostLower = resolvedHost.toLowerCase();
          const hostMatches = certHosts.some((certHost) => {
            // Exact match
            if (certHost === requestedHostLower) return true;
            
            // Wildcard match (e.g., *.example.com matches sub.example.com)
            if (certHost.startsWith('*.')) {
              const wildcardDomain = certHost.slice(2); // Remove "*."
              const hostParts = requestedHostLower.split('.');
              const domainParts = wildcardDomain.split('.');
              
              // Host must have at least one more subdomain than the wildcard domain
              if (hostParts.length > domainParts.length) {
                const hostDomain = hostParts.slice(1).join('.');
                return hostDomain === wildcardDomain;
              }
            }
            
            return false;
          });

          // For IP addresses, also check if the CN or SAN contains the IP
          const isIPAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(resolvedHost);
          
          // Check 3: Host must match certificate (reject if mismatch)
          // For IP addresses, we allow mismatch since self-signed certs often use hostnames
          if (!hostMatches && !isIPAddress) {
            socket.destroy();
            reject(new BadRequestException({
              message: `Certificate host mismatch: requested host '${resolvedHost}' does not match certificate hosts [${certHosts.join(', ')}]`,
              host,
              resolvedHost,
              resolvedPort,
              certificateHosts: certHosts,
              hostMatches: false,
            }));
            return;
          }

          // For IP addresses, log warning but allow (self-signed certs typically don't include IPs in SAN)
          if (!hostMatches && isIPAddress) {
            this.logger.warn(
              `Certificate host check skipped for IP address ${resolvedHost}. ` +
              `Certificate hosts: [${certHosts.join(', ')}]. This is expected for self-signed certificates.`
            );
          }

          // Convert DER-encoded certificate to PEM format
          let certificatePEM: string | undefined;
          if (cert.raw) {
            const base64Cert = cert.raw.toString('base64');
            // Split into 64-character lines for proper PEM format
            const lines = base64Cert.match(/.{1,64}/g) || [];
            certificatePEM = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
          }

          const response: FetchCertificateResponseDTO = {
            isSelfSigned,
            subject: {
              CN: cert.subject?.CN,
              O: cert.subject?.O,
              OU: cert.subject?.OU,
              C: cert.subject?.C,
              ST: cert.subject?.ST,
              L: cert.subject?.L,
            },
            issuer: {
              CN: cert.issuer?.CN,
              O: cert.issuer?.O,
              OU: cert.issuer?.OU,
              C: cert.issuer?.C,
              ST: cert.issuer?.ST,
              L: cert.issuer?.L,
            },
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            serialNumber: cert.serialNumber,
            fingerprint: cert.fingerprint,
            fingerprint256: cert.fingerprint256,
            subjectAltNames,
            daysRemaining,
            isExpired,
            issuerChain,
            certificatePEM,
            host: resolvedHost,
            port: resolvedPort,
            hostMatches,
            certificateHosts: certHosts,
          };

          socket.destroy();
          this.logger.log(`Successfully fetched certificate from ${resolvedHost}:${resolvedPort}, isSelfSigned: ${isSelfSigned}`);
          resolve(response);
        } catch (error) {
          socket.destroy();
          this.logger.error(`Error parsing certificate from ${resolvedHost}:${resolvedPort}: ${error.message}`);
          reject(new InternalServerErrorException({
            message: `Failed to parse certificate: ${error.message}`,
            host,
            resolvedHost,
            resolvedPort,
          }));
        }
      });

      socket.on('error', (err) => {
        this.logger.error(`TLS connection error to ${resolvedHost}:${resolvedPort}: ${err.message}`);
        reject(new BadRequestException({
          message: `Connection failed to ${resolvedHost}:${resolvedPort}: ${err.message}`,
          host,
          resolvedHost,
          resolvedPort,
        }));
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        this.logger.error(`TLS connection timeout to ${resolvedHost}:${resolvedPort}`);
        reject(new BadRequestException({
          message: `Connection timeout to ${resolvedHost}:${resolvedPort}`,
          host,
          resolvedHost,
          resolvedPort,
        }));
      });
    });
  }

  /**
   * Parse host string to extract host and port
   * Handles formats like: "10.192.7.32", "10.192.7.32:8080", "https://example.com"
   */
  protected parseHostString(hostString: string, defaultPort?: number): { host: string; port: number } {
    // Strip protocol prefix if present (http://, https://)
    let cleanedHost = hostString.replace(/^https?:\/\//, '');
    
    // Remove trailing slash and path if present
    cleanedHost = cleanedHost.split('/')[0];
    
    const parts = cleanedHost.split(':');
    const host = parts[0];
    const isIPAddress = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    
    // Priority: explicit port > defaultPort param > heuristic (8080 for IP, 443 for domain)
    let port: number;
    if (parts.length > 1) {
      port = parseInt(parts[1], 10);
    } else if (defaultPort !== undefined) {
      port = defaultPort;
    } else {
      port = isIPAddress ? 8080 : 443;
    }
    
    return { host, port };
  }

  /**
   * Extract issuer chain from certificate
   */
  protected extractIssuerChain(cert: any): any[] {
    const chain: any[] = [];
    let current = cert;
    
    while (current && current.issuerCertificate && current !== current.issuerCertificate) {
      chain.push({
        CN: current.issuer?.CN,
        O: current.issuer?.O,
        OU: current.issuer?.OU,
        C: current.issuer?.C,
        ST: current.issuer?.ST,
        L: current.issuer?.L,
      });
      current = current.issuerCertificate;
    }
    
    return chain;
  }
}
