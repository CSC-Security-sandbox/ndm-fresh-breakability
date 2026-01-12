import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as tls from 'tls';
import { StorageClient } from './storage-client';

// Mock tls module
jest.mock('tls');

// Concrete implementation of abstract StorageClient for testing
class TestStorageClient extends StorageClient {
  hostname = 'test.example.com';
  port = 8080;
  username = 'testuser';
  password = 'testpass';
  certificate = '';
  
  constructor(logger: LoggerService) {
    super(logger);
  }

  async fetchZones(): Promise<any> {
    return { zones: [] };
  }

  async getNFSExportPaths(fileServerId: string): Promise<any[]> {
    return [];
  }

  async getSMBShares(fileServerId: string): Promise<any[]> {
    return [];
  }

  async validateConnection(): Promise<boolean> {
    return true;
  }

  async configureSmartConnectDns(traceId: string, fileServer: any): Promise<boolean> {
    return false;
  }

  // Expose protected methods for testing
  public testParseHostString(hostString: string, defaultPort?: number) {
    return this.parseHostString(hostString, defaultPort);
  }

  public testExtractIssuerChain(cert: any) {
    return this.extractIssuerChain(cert);
  }
}

describe('StorageClient', () => {
  let storageClient: TestStorageClient;
  let mockLogger: LoggerService;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    storageClient = new TestStorageClient(mockLogger);
    jest.clearAllMocks();
  });

  describe('parseHostString', () => {
    it('should parse plain IP address with default port 8080', () => {
      const result = storageClient.testParseHostString('10.192.7.32');
      expect(result.host).toBe('10.192.7.32');
      expect(result.port).toBe(8080);
    });

    it('should parse IP address with explicit port', () => {
      const result = storageClient.testParseHostString('10.192.7.32:9443');
      expect(result.host).toBe('10.192.7.32');
      expect(result.port).toBe(9443);
    });

    it('should parse domain name with default port 443', () => {
      const result = storageClient.testParseHostString('isilon.example.com');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(443);
    });

    it('should parse domain name with explicit port', () => {
      const result = storageClient.testParseHostString('isilon.example.com:8080');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(8080);
    });

    it('should strip https:// prefix', () => {
      const result = storageClient.testParseHostString('https://isilon.example.com');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(443);
    });

    it('should strip http:// prefix', () => {
      const result = storageClient.testParseHostString('http://isilon.example.com');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(443);
    });

    it('should strip trailing path', () => {
      const result = storageClient.testParseHostString('https://isilon.example.com/api/v1');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(443);
    });

    it('should use provided defaultPort when no port in string', () => {
      const result = storageClient.testParseHostString('10.192.7.32', 9000);
      expect(result.host).toBe('10.192.7.32');
      expect(result.port).toBe(9000);
    });

    it('should use explicit port over defaultPort', () => {
      const result = storageClient.testParseHostString('10.192.7.32:8443', 9000);
      expect(result.host).toBe('10.192.7.32');
      expect(result.port).toBe(8443);
    });

    it('should handle URL with port and path', () => {
      const result = storageClient.testParseHostString('https://isilon.example.com:8080/api');
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(8080);
    });
  });

  describe('extractIssuerChain', () => {
    it('should return empty array when no issuer certificate', () => {
      const cert = {
        subject: { CN: 'test' },
        issuer: { CN: 'issuer' },
        issuerCertificate: null,
      };

      const result = storageClient.testExtractIssuerChain(cert);
      expect(result).toEqual([]);
    });

    it('should return empty array when self-signed (issuerCertificate equals cert)', () => {
      const cert: any = {
        subject: { CN: 'test' },
        issuer: { CN: 'test' },
      };
      cert.issuerCertificate = cert; // Self-signed

      const result = storageClient.testExtractIssuerChain(cert);
      expect(result).toEqual([]);
    });

    it('should extract single issuer', () => {
      const rootCert: any = {
        subject: { CN: 'Root CA' },
        issuer: { CN: 'Root CA', O: 'Root Org' },
      };
      rootCert.issuerCertificate = rootCert;

      const cert = {
        subject: { CN: 'test' },
        issuer: { CN: 'Intermediate CA', O: 'Intermediate Org', OU: 'OU1', C: 'US', ST: 'CA', L: 'SF' },
        issuerCertificate: rootCert,
      };

      const result = storageClient.testExtractIssuerChain(cert);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        CN: 'Intermediate CA',
        O: 'Intermediate Org',
        OU: 'OU1',
        C: 'US',
        ST: 'CA',
        L: 'SF',
      });
    });

    it('should extract chain of multiple issuers', () => {
      const rootCert: any = {
        subject: { CN: 'Root CA' },
        issuer: { CN: 'Root CA' },
      };
      rootCert.issuerCertificate = rootCert;

      const intermediateCert = {
        subject: { CN: 'Intermediate CA' },
        issuer: { CN: 'Root CA' },
        issuerCertificate: rootCert,
      };

      const cert = {
        subject: { CN: 'test' },
        issuer: { CN: 'Intermediate CA' },
        issuerCertificate: intermediateCert,
      };

      const result = storageClient.testExtractIssuerChain(cert);
      expect(result).toHaveLength(2);
      expect(result[0].CN).toBe('Intermediate CA');
      expect(result[1].CN).toBe('Root CA');
    });
  });

  describe('fetchCertificate', () => {
    let mockSocket: any;

    beforeEach(() => {
      mockSocket = {
        getPeerCertificate: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn(),
        setTimeout: jest.fn(),
      };

      (tls.connect as jest.Mock).mockImplementation((options, callback) => {
        // Immediately call the callback to simulate connection
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return mockSocket;
      });
    });

    it('should successfully fetch certificate from host', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30); // 30 days ago
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335); // 335 days in the future

      const mockCert = {
        subject: { CN: 'isilon.example.com', O: 'Test Org', OU: 'IT', C: 'US', ST: 'CA', L: 'SF' },
        issuer: { CN: 'Test CA', O: 'CA Org', OU: 'CA', C: 'US', ST: 'CA', L: 'SF' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        serialNumber: '1234567890',
        fingerprint: 'AA:BB:CC:DD',
        fingerprint256: 'AA:BB:CC:DD:EE:FF',
        subjectaltname: 'DNS:isilon.example.com, DNS:*.example.com',
        raw: Buffer.from('test-cert-data'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result).toBeDefined();
      expect(result.host).toBe('isilon.example.com');
      expect(result.port).toBe(8080);
      expect(result.subject.CN).toBe('isilon.example.com');
      expect(result.issuer.CN).toBe('Test CA');
      expect(result.isExpired).toBe(false);
      expect(result.certificatePEM).toContain('-----BEGIN CERTIFICATE-----');
      expect(result.certificatePEM).toContain('-----END CERTIFICATE-----');
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('should reject when no certificate received', async () => {
      mockSocket.getPeerCertificate.mockReturnValue({});

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when certificate is expired', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 60);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() - 30); // Expired 30 days ago

      const mockCert = {
        subject: { CN: 'isilon.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        raw: Buffer.from('test'),
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when certificate host does not match (domain)', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'other.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:other.example.com',
        raw: Buffer.from('test'),
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow IP address even when host does not match certificate', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com', O: 'Org' },
        issuer: { CN: 'isilon.example.com', O: 'Org' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com',
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('10.192.7.32', 8080);

      expect(result).toBeDefined();
      expect(result.hostMatches).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle wildcard certificate matching', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: '*.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:*.example.com',
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result).toBeDefined();
      expect(result.hostMatches).toBe(true);
    });

    it('should correctly identify self-signed certificate', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com', O: 'Self Org' },
        issuer: { CN: 'isilon.example.com', O: 'Self Org' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com',
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result.isSelfSigned).toBe(true);
    });

    it('should reject on connection error', async () => {
      (tls.connect as jest.Mock).mockImplementation((options, callback) => {
        const errorSocket = {
          getPeerCertificate: jest.fn(),
          destroy: jest.fn(),
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              setTimeout(() => handler(new Error('Connection refused')), 0);
            }
          }),
          setTimeout: jest.fn(),
        };
        return errorSocket;
      });

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject on connection timeout', async () => {
      (tls.connect as jest.Mock).mockImplementation((options, callback) => {
        const timeoutSocket = {
          getPeerCertificate: jest.fn(),
          destroy: jest.fn(),
          on: jest.fn(),
          setTimeout: jest.fn((timeout, handler) => {
            setTimeout(() => handler(), 0);
          }),
        };
        return timeoutSocket;
      });

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject on certificate parsing error', async () => {
      mockSocket.getPeerCertificate.mockImplementation(() => {
        throw new Error('Parse error');
      });

      await expect(
        storageClient.fetchCertificate('isilon.example.com', 8080)
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should handle certificate with IP address in SAN', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com, IP Address:10.192.7.32',
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('10.192.7.32', 8080);

      expect(result).toBeDefined();
      expect(result.hostMatches).toBe(true);
    });

    it('should use default port based on host type', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com',
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com');

      expect(result.port).toBe(443); // Domain uses 443 by default
    });

    it('should handle certificate without raw data', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com',
        // No raw property
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result).toBeDefined();
      expect(result.certificatePEM).toBeUndefined();
    });

    it('should handle certificate without subjectaltname', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const mockCert = {
        subject: { CN: 'isilon.example.com' },
        issuer: { CN: 'Test CA' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        raw: Buffer.from('test'),
        issuerCertificate: null,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result).toBeDefined();
      expect(result.subjectAltNames).toEqual([]);
    });

    it('should detect non-self-signed certificate when issuerCertificate differs', async () => {
      const validFrom = new Date();
      validFrom.setDate(validFrom.getDate() - 30);
      const validTo = new Date();
      validTo.setDate(validTo.getDate() + 335);

      const issuerCert = {
        subject: { CN: 'Root CA', O: 'Root Org' },
        issuer: { CN: 'Root CA', O: 'Root Org' },
      };

      const mockCert = {
        subject: { CN: 'isilon.example.com', O: 'Test Org' },
        issuer: { CN: 'Root CA', O: 'Root Org' },
        valid_from: validFrom.toISOString(),
        valid_to: validTo.toISOString(),
        subjectaltname: 'DNS:isilon.example.com',
        raw: Buffer.from('test'),
        issuerCertificate: issuerCert,
      };

      mockSocket.getPeerCertificate.mockReturnValue(mockCert);

      const result = await storageClient.fetchCertificate('isilon.example.com', 8080);

      expect(result.isSelfSigned).toBe(false);
    });
  });

  describe('abstract methods', () => {
    it('should have fetchZones implementation', async () => {
      const result = await storageClient.fetchZones();
      expect(result).toEqual({ zones: [] });
    });

    it('should have getNFSExportPaths implementation', async () => {
      const result = await storageClient.getNFSExportPaths('test-id');
      expect(result).toEqual([]);
    });

    it('should have getSMBShares implementation', async () => {
      const result = await storageClient.getSMBShares('test-id');
      expect(result).toEqual([]);
    });

    it('should have validateConnection implementation', async () => {
      const result = await storageClient.validateConnection();
      expect(result).toBe(true);
    });
  });
});
