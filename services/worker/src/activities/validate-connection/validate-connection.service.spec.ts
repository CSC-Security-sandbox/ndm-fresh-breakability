import { Test, TestingModule } from '@nestjs/testing';
import { ValidateConnectionActivity } from './validate-connection.service';
import { ConfigService } from '@nestjs/config';
import { Protocol } from 'src/protocols/protocol/protocol';
import { Protocols, ProtocolTypes } from 'src/protocols/protocols';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('src/protocols/protocols'); // Mock Protocols module

describe('ValidateConnectionActivity', () => {
  let service: ValidateConnectionActivity;
  let mockConfigService: Partial<ConfigService>;
  let protocols: Protocols;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-worker-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateConnectionActivity,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
        {
          provide: Protocols,
          useValue: {
            getProtocol: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ValidateConnectionActivity>(ValidateConnectionActivity);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    protocols = module.get<Protocols>(Protocols);
  });

  it('should validate connection successfully and fetch paths and versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: true, enableVersionFetch: true };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockResolvedValue(['path1', 'path2']),
      getProtocolVersions: jest.fn().mockResolvedValue(['v1', 'v2']),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(response.paths).toEqual(['path1', 'path2']);
    expect(response.protocolVersions).toEqual(['v1', 'v2']);
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Validating connection for ${payload.hostname} of type ${protocolType} from test-worker-id`);
  });

  it('should validate connection successfully without fetching paths and versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn(),
      getProtocolVersions: jest.fn(),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(response.paths).toEqual([]);
    expect(response.protocolVersions).toEqual([]);
  });

  it('should handle error during validation', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockRejectedValue(new Error('Validation error')),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Validation error');
  });

  it('should handle error when fetching paths', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: true, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockRejectedValue(new Error('Fetch paths error')),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Fetch paths error');
  });

  it('should handle error when fetching protocol versions', async () => {
    const traceId = 'trace-123';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: true };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      getProtocolVersions: jest.fn().mockRejectedValue(new Error('Fetch versions error')),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('error');
    expect(response.message).toContain('Failed to validate connection for localhost of type HTTP: Error: Fetch versions error');
  });

  // --- Warning propagation ---

  it('should propagate warnings returned by validateConnection into the response', async () => {
    const traceId = 'trace-warn-1';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] }),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(response.warnings).toEqual(['BACKUP_OPERATORS_NOT_MEMBER']);
  });

  it('should propagate multiple warnings returned by validateConnection', async () => {
    const traceId = 'trace-warn-2';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED', 'BACKUP_OPERATORS_NOT_MEMBER'],
      }),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.warnings).toEqual(['BACKUP_OPERATORS_CHECK_SKIPPED', 'BACKUP_OPERATORS_NOT_MEMBER']);
  });

  it('should default warnings to [] when validateConnection returns undefined', async () => {
    const traceId = 'trace-warn-3';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.warnings).toEqual([]);
  });

  it('should default warnings to [] when validateConnection returns null', async () => {
    const traceId = 'trace-warn-4';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(null),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.warnings).toEqual([]);
  });

  it('should default warnings to [] when validateConnection returns object with no warnings field', async () => {
    const traceId = 'trace-warn-5';
    const protocolType = 'HTTP';
    const payload = { hostname: 'localhost' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({}),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.warnings).toEqual([]);
  });

  // --- SMB disconnect ---

  it('should call disconnectSession after successful validation for SMB protocol', async () => {
    const traceId = 'trace-smb-1';
    const protocolType = 'SMB';
    const payload = { hostname: 'smb-host' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
      disconnectSession: jest.fn().mockResolvedValue('disconnected'),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(mockProtocol.disconnectSession).toHaveBeenCalledWith(traceId, payload);
    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] disconnecting session for SMB`);
  });

  it('should NOT call disconnectSession for non-SMB protocols', async () => {
    const traceId = 'trace-nfs-1';
    const protocolType = 'NFS';
    const payload = { hostname: 'nfs-host' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
      disconnectSession: jest.fn(),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    await service.validate(traceId, protocolType, payload, feature);

    expect(mockProtocol.disconnectSession).not.toHaveBeenCalled();
  });

  it('should treat SMB disconnect failure as non-fatal and still return success', async () => {
    const traceId = 'trace-smb-2';
    const protocolType = 'SMB';
    const payload = { hostname: 'smb-host' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
      disconnectSession: jest.fn().mockRejectedValue(new Error('disconnect failed')),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate(traceId, protocolType, payload, feature);

    expect(response.status).toBe('success');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to disconnect SMB session (non-fatal): disconnect failed')
    );
  });

  it('should log the disconnect response when SMB disconnect succeeds', async () => {
    const traceId = 'trace-smb-3';
    const protocolType = 'SMB';
    const payload = { hostname: 'smb-host' };
    const feature = { enablePreListPath: false, enableVersionFetch: false };

    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
      disconnectSession: jest.fn().mockResolvedValue('session closed'),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    await service.validate(traceId, protocolType, payload, feature);

    expect(mockLogger.log).toHaveBeenCalledWith(`[${traceId}] Disconnect response: session closed`);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test plan: SMB Backup Operators check — file server creation scenarios
  // ───────────────────────────────────────────────────────────────────────────

  describe('SMB file server creation — Backup Operators group check', () => {
    const smbPayload = { hostname: 'smb-server.corp.local', username: 'svc-user', password: 'secret' };
    const smbFeature = { enablePreListPath: true, enableVersionFetch: true };

    // ── Scenario: worker NOT part of domain ────────────────────────────────

    describe('worker is NOT part of a domain', () => {
      it('should complete file server creation successfully and surface BACKUP_OPERATORS_CHECK_SKIPPED warning', async () => {
        // smb.protocol returns SKIPPED when machine is not domain-joined
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'] }),
          listPaths: jest.fn().mockResolvedValue(['/share1', '/share2']),
          getProtocolVersions: jest.fn().mockResolvedValue(['SMB2', 'SMB3']),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        const response = await service.validate('trace-domain-1', 'SMB', smbPayload, smbFeature);

        // File server creation must succeed — the warning is advisory only
        expect(response.status).toBe('success');
        expect(response.warnings).toEqual(['BACKUP_OPERATORS_CHECK_SKIPPED']);

        // Paths and versions are still fetched so the file server can be saved
        expect(response.paths).toEqual(['/share1', '/share2']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });

      it('should still call disconnectSession even when check was skipped (not domain-joined)', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'] }),
          listPaths: jest.fn().mockResolvedValue([]),
          getProtocolVersions: jest.fn().mockResolvedValue([]),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        await service.validate('trace-domain-2', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(mockProtocol.disconnectSession).toHaveBeenCalled();
      });
    });

    // ── Scenario: worker IS domain-joined, user is NOT in Backup Operators ──

    describe('worker IS domain-joined — user NOT a Backup Operator', () => {
      it('should complete file server creation successfully and surface BACKUP_OPERATORS_NOT_MEMBER warning', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] }),
          listPaths: jest.fn().mockResolvedValue(['/share1']),
          getProtocolVersions: jest.fn().mockResolvedValue(['SMB3']),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        const response = await service.validate('trace-domain-3', 'SMB', smbPayload, smbFeature);

        // File server creation proceeds — user sees warning but is not blocked
        expect(response.status).toBe('success');
        expect(response.warnings).toEqual(['BACKUP_OPERATORS_NOT_MEMBER']);
        expect(response.paths).toEqual(['/share1']);
        expect(response.protocolVersions).toEqual(['SMB3']);
      });

      it('should not return an error status when user is not in Backup Operators', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] }),
          listPaths: jest.fn().mockResolvedValue([]),
          getProtocolVersions: jest.fn().mockResolvedValue([]),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        const response = await service.validate('trace-domain-4', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(response.status).not.toBe('error');
        expect(response.message).toContain('validated successfully');
      });
    });

    // ── Scenario: worker IS domain-joined, user IS in Backup Operators ──────

    describe('worker IS domain-joined — user IS a Backup Operator (correct setup)', () => {
      it('should complete file server creation successfully with no warnings when user is a member', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
          listPaths: jest.fn().mockResolvedValue(['/share1', '/share2', '/share3']),
          getProtocolVersions: jest.fn().mockResolvedValue(['SMB2', 'SMB3']),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        const response = await service.validate('trace-domain-5', 'SMB', smbPayload, smbFeature);

        expect(response.status).toBe('success');
        expect(response.warnings).toEqual([]);
        expect(response.paths).toEqual(['/share1', '/share2', '/share3']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });

      it('should return all paths and protocol versions when user is correct — nothing is skipped', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
          listPaths: jest.fn().mockResolvedValue(['/data', '/backup']),
          getProtocolVersions: jest.fn().mockResolvedValue(['SMB3']),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        const response = await service.validate('trace-domain-6', 'SMB', smbPayload, smbFeature);

        expect(mockProtocol.listPaths).toHaveBeenCalledWith('trace-domain-6', smbPayload);
        expect(mockProtocol.getProtocolVersions).toHaveBeenCalledWith('trace-domain-6', smbPayload);
        expect(response.paths).toEqual(['/data', '/backup']);
        expect(response.protocolVersions).toEqual(['SMB3']);
      });

      it('should call disconnectSession after validation when user is correct', async () => {
        const mockProtocol = {
          validateConnection: jest.fn().mockResolvedValue({ warnings: [] }),
          listPaths: jest.fn().mockResolvedValue([]),
          getProtocolVersions: jest.fn().mockResolvedValue([]),
          disconnectSession: jest.fn().mockResolvedValue('ok'),
        };
        (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

        await service.validate('trace-domain-7', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(mockProtocol.disconnectSession).toHaveBeenCalledWith('trace-domain-7', smbPayload);
      });
    });
  });
}); 