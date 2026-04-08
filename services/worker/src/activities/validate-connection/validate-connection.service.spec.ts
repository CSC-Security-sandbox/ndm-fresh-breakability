import { Test, TestingModule } from '@nestjs/testing';
import { ValidateConnectionActivity } from './validate-connection.service';
import { ConfigService } from '@nestjs/config';
import { Protocols } from 'src/protocols/protocols';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { WindowsPrivilegeService } from 'src/protocols/smb/windows-privilege.service';
import { mockLogger } from 'src/auth/auth.service.spec';

jest.mock('src/protocols/protocols');

describe('ValidateConnectionActivity', () => {
  let service: ValidateConnectionActivity;
  let protocols: Protocols;
  let mockWindowsPrivilegeService: jest.Mocked<Pick<WindowsPrivilegeService, 'checkBackupOperatorMembership'>>;

  beforeEach(async () => {
    mockWindowsPrivilegeService = {
      checkBackupOperatorMembership: jest.fn().mockResolvedValue('IS_MEMBER'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateConnectionActivity,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-worker-id') } },
        { provide: LoggerFactory, useValue: { create: jest.fn().mockReturnValue(mockLogger) } },
        { provide: Protocols, useValue: { getProtocol: jest.fn() } },
        { provide: WindowsPrivilegeService, useValue: mockWindowsPrivilegeService },
      ],
    }).compile();

    service = module.get<ValidateConnectionActivity>(ValidateConnectionActivity);
    protocols = module.get<Protocols>(Protocols);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Basic connectivity ─────────────────────────────────────────────────────

  it('should validate connection successfully and fetch paths and versions', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockResolvedValue(['path1', 'path2']),
      getProtocolVersions: jest.fn().mockResolvedValue(['v1', 'v2']),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: true, enableVersionFetch: true });

    expect(response.status).toBe('success');
    expect(response.paths).toEqual(['path1', 'path2']);
    expect(response.protocolVersions).toEqual(['v1', 'v2']);
    expect(mockLogger.log).toHaveBeenCalledWith('[trace-123] Validating connection for localhost of type NFS from test-worker-id');
  });

  it('should validate connection successfully without fetching paths and versions', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn(),
      getProtocolVersions: jest.fn(),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(response.status).toBe('success');
    expect(response.paths).toEqual([]);
    expect(response.protocolVersions).toEqual([]);
    expect(mockProtocol.listPaths).not.toHaveBeenCalled();
    expect(mockProtocol.getProtocolVersions).not.toHaveBeenCalled();
  });

  it('should return empty warnings when connectivity check passes with no issues', async () => {
    const mockProtocol = { validateConnection: jest.fn().mockResolvedValue(undefined) };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(response.warnings).toEqual([]);
  });

  it('should handle error during validation', async () => {
    const mockProtocol = { validateConnection: jest.fn().mockRejectedValue(new Error('Validation error')) };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(response.status).toBe('error');
    expect(response.warnings).toEqual([]);
    expect(response.message).toContain('Failed to validate connection for localhost of type NFS: Error: Validation error');
  });

  it('should handle error when fetching paths', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      listPaths: jest.fn().mockRejectedValue(new Error('Fetch paths error')),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: true, enableVersionFetch: false });

    expect(response.status).toBe('error');
    expect(response.message).toContain('Fetch paths error');
  });

  it('should handle error when fetching protocol versions', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      getProtocolVersions: jest.fn().mockRejectedValue(new Error('Fetch versions error')),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-123', 'NFS', { hostname: 'localhost' }, { enablePreListPath: false, enableVersionFetch: true });

    expect(response.status).toBe('error');
    expect(response.message).toContain('Fetch versions error');
  });

  // ── SMB disconnect ─────────────────────────────────────────────────────────

  it('should call disconnectSession after successful validation for SMB protocol', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      disconnectSession: jest.fn().mockResolvedValue('disconnected'),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-smb-1', 'SMB', { hostname: 'smb-host', username: 'u', password: 'p' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(response.status).toBe('success');
    expect(mockProtocol.disconnectSession).toHaveBeenCalledWith('trace-smb-1', { hostname: 'smb-host', username: 'u', password: 'p' });
    expect(mockLogger.log).toHaveBeenCalledWith('[trace-smb-1] disconnecting session for SMB');
  });

  it('should NOT call disconnectSession for non-SMB protocols', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      disconnectSession: jest.fn(),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    await service.validate('trace-nfs-1', 'NFS', { hostname: 'nfs-host' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(mockProtocol.disconnectSession).not.toHaveBeenCalled();
  });

  it('should treat SMB disconnect failure as non-fatal and still return success', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      disconnectSession: jest.fn().mockRejectedValue(new Error('disconnect failed')),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    const response = await service.validate('trace-smb-2', 'SMB', { hostname: 'smb-host', username: 'u', password: 'p' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(response.status).toBe('success');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to disconnect SMB session (non-fatal): disconnect failed'),
    );
  });

  it('should log the disconnect response when SMB disconnect succeeds', async () => {
    const mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(undefined),
      disconnectSession: jest.fn().mockResolvedValue('session closed'),
    };
    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

    await service.validate('trace-smb-3', 'SMB', { hostname: 'smb-host', username: 'u', password: 'p' }, { enablePreListPath: false, enableVersionFetch: false });

    expect(mockLogger.log).toHaveBeenCalledWith('[trace-smb-3] Disconnect response: session closed');
  });

  // ── SMB Backup Operators check — file server creation only ─────────────────
  // The check runs via WindowsPrivilegeService injected into this activity.
  // It does NOT run during job precheck (PrecheckActivity only calls protocol.validateConnection).

  describe('SMB file server creation — Backup Operators group check', () => {
    const smbPayload = { hostname: 'smb-server.corp.local', username: 'svc-user', password: 'secret' };
    const feature = { enablePreListPath: true, enableVersionFetch: true };

    let mockProtocol: any;

    beforeEach(() => {
      mockProtocol = {
        validateConnection: jest.fn().mockResolvedValue(undefined),
        listPaths: jest.fn().mockResolvedValue(['/share1', '/share2']),
        getProtocolVersions: jest.fn().mockResolvedValue(['SMB2', 'SMB3']),
        disconnectSession: jest.fn().mockResolvedValue('ok'),
      };
      (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);
    });

    // ── Worker NOT domain-joined ───────────────────────────────────────────

    describe('worker is NOT part of a domain', () => {
      it('should surface BACKUP_OPERATORS_CHECK_SKIPPED warning and still succeed', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('NOT_DOMAIN_JOINED');

        const response = await service.validate('trace-d1', 'SMB', smbPayload, feature);

        expect(response.status).toBe('success');
        expect(response.warnings).toEqual(['BACKUP_OPERATORS_CHECK_SKIPPED']);
        expect(response.paths).toEqual(['/share1', '/share2']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });

      it('should pass username and password to the membership check', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('NOT_DOMAIN_JOINED');

        await service.validate('trace-d2', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(mockWindowsPrivilegeService.checkBackupOperatorMembership).toHaveBeenCalledWith(
          'trace-d2', smbPayload.username, smbPayload.password,
        );
      });

      it('should surface BACKUP_OPERATORS_CHECK_SKIPPED warning when ERROR is returned (LDAP failure)', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('ERROR');

        const response = await service.validate('trace-d1b', 'SMB', smbPayload, feature);

        expect(response.status).toBe('success');
        expect(response.warnings).toEqual(['BACKUP_OPERATORS_CHECK_SKIPPED']);
      });

      it('should still call disconnectSession even when check was skipped', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('NOT_DOMAIN_JOINED');

        await service.validate('trace-d3', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(mockProtocol.disconnectSession).toHaveBeenCalled();
      });
    });

    // ── Worker domain-joined, user NOT in Backup Operators ─────────────────

    describe('worker IS domain-joined — user NOT a Backup Operator', () => {
      it('should surface BACKUP_OPERATORS_NOT_MEMBER warning and still succeed', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('NOT_MEMBER');

        const response = await service.validate('trace-d4', 'SMB', smbPayload, feature);

        expect(response.status).toBe('success');
        expect(response.warnings).toEqual(['BACKUP_OPERATORS_NOT_MEMBER']);
        expect(response.paths).toEqual(['/share1', '/share2']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });

      it('should not return an error status — warning is advisory only', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('NOT_MEMBER');

        const response = await service.validate('trace-d5', 'SMB', smbPayload, { enablePreListPath: false, enableVersionFetch: false });

        expect(response.status).not.toBe('error');
        expect(response.message).toContain('validated successfully');
      });
    });

    // ── Worker domain-joined, user IS in Backup Operators (correct) ────────

    describe('worker IS domain-joined — user IS a Backup Operator', () => {
      it('should complete with no warnings when user is a member', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('IS_MEMBER');

        const response = await service.validate('trace-d6', 'SMB', smbPayload, feature);

        expect(response.status).toBe('success');
        expect(response.warnings).toEqual([]);
        expect(response.paths).toEqual(['/share1', '/share2']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });

      it('should fetch all paths and versions when user is correctly configured', async () => {
        mockWindowsPrivilegeService.checkBackupOperatorMembership.mockResolvedValue('IS_MEMBER');

        const response = await service.validate('trace-d7', 'SMB', smbPayload, feature);

        expect(mockProtocol.listPaths).toHaveBeenCalledWith('trace-d7', smbPayload);
        expect(mockProtocol.getProtocolVersions).toHaveBeenCalledWith('trace-d7', smbPayload);
        expect(response.paths).toEqual(['/share1', '/share2']);
        expect(response.protocolVersions).toEqual(['SMB2', 'SMB3']);
      });
    });

    // ── Non-SMB protocol — check must NOT run ──────────────────────────────

    it('should NOT call checkBackupOperatorMembership for non-SMB protocols (NFS)', async () => {
      const response = await service.validate('trace-nfs', 'NFS', { hostname: 'nfs-host' }, { enablePreListPath: false, enableVersionFetch: false });

      expect(mockWindowsPrivilegeService.checkBackupOperatorMembership).not.toHaveBeenCalled();
      expect(response.warnings).toEqual([]);
    });
  });
});
