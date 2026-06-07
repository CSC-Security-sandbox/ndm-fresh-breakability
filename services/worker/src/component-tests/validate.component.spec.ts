import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ValidateConnectionActivity } from '../activities/validate-connection/validate-connection.service';
import { Protocols, ProtocolTypes } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';

/**
 *
 * Real classes wired together:
 *   ValidateConnectionActivity → Protocols → NFSProtocol / SMBProtocol
 *
 * Mocked boundaries:
 *   NFSProtocol.validateConnection  (real TCP socket — network boundary)
 *   NFSProtocol.listPaths           (real shell exec — filesystem boundary)
 *   NFSProtocol.getProtocolVersions (real shell exec — filesystem boundary)
 *   SMBProtocol.*                   (same reason)
 *   ConfigService
 *
 * What this verifies over the existing UT:
 *   - The existing UT mocks the entire Protocols class (jest.mock('src/protocols/protocols'))
 *     so getProtocol() is never called on the real class — an unsupported protocol type
 *     would never throw, and the NFS/SMB routing decision is never tested.
 *   - This component test wires real Protocols + real NFSProtocol/SMBProtocol classes
 *     so the routing logic (getProtocol switch) and the feature flag branching
 *     (enablePreListPath, enableVersionFetch) are exercised through the real chain.
 */

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
};

describe('Component: validate (ValidateConnectionActivity)', () => {
  let activity: ValidateConnectionActivity;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const map = {
        'worker.workerId': 'worker-1',
        'worker.baseMountDir': '/mnt',
        'worker.platform': 'linux',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // WorkersConfig is a static singleton used inside Protocol base class constructor.
    // It must be instantiated before NFSProtocol / SMBProtocol are created.
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateConnectionActivity, // REAL
        Protocols,                  // REAL — routes NFS/SMB via switch
        NFSProtocol,                // REAL class, boundary methods mocked per test
        SMBProtocol,                // REAL class, boundary methods mocked per test
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    activity   = module.get<ValidateConnectionActivity>(ValidateConnectionActivity);
    nfsProtocol = module.get<NFSProtocol>(NFSProtocol);
    smbProtocol = module.get<SMBProtocol>(SMBProtocol);
  });

  // ─── H1: NFS — validateConnection success, paths + versions fetched ───

  it('H1 — NFS happy path: validateConnection + listPaths + getProtocolVersions all succeed', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue('Connection established');
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/src', '/vol/dest']);
    jest.spyOn(nfsProtocol, 'getProtocolVersions').mockResolvedValue(['NFSv3', 'NFSv4']);

    const result = await activity.validate(
      'trace-001',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: true, enableVersionFetch: true },
    );

    // Real Protocols.getProtocol was called and routed to NFSProtocol
    expect(nfsProtocol.validateConnection).toHaveBeenCalledWith('trace-001', { hostname: '10.0.0.1' });
    expect(nfsProtocol.listPaths).toHaveBeenCalledWith('trace-001', { hostname: '10.0.0.1' });
    expect(nfsProtocol.getProtocolVersions).toHaveBeenCalledWith('trace-001', { hostname: '10.0.0.1' });

    expect(result.status).toBe('success');
    expect(result.paths).toEqual(['/vol/src', '/vol/dest']);
    expect(result.protocolVersions).toEqual(['NFSv3', 'NFSv4']);
    expect(result.workerId).toBe('worker-1');
  });

  // ─── H2: NFS — validateConnection only (feature flags off) ───

  it('H2 — NFS: validateConnection only when enablePreListPath and enableVersionFetch are false', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue('Connection established');
    const listPathsSpy = jest.spyOn(nfsProtocol, 'listPaths');
    const versionsSpy  = jest.spyOn(nfsProtocol, 'getProtocolVersions');

    const result = await activity.validate(
      'trace-002',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: false, enableVersionFetch: false },
    );

    expect(result.status).toBe('success');
    expect(result.paths).toEqual([]);
    expect(result.protocolVersions).toEqual([]);
    // listPaths and getProtocolVersions must NOT be called
    expect(listPathsSpy).not.toHaveBeenCalled();
    expect(versionsSpy).not.toHaveBeenCalled();
  });

  // ─── H3: SMB — routes to SMBProtocol via real Protocols.getProtocol switch ───

  it('H3 — SMB: real Protocols.getProtocol routes to SMBProtocol, not NFSProtocol', async () => {
    jest.spyOn(smbProtocol, 'validateConnection').mockResolvedValue('SMB connected');
    jest.spyOn(smbProtocol, 'listPaths').mockResolvedValue(['\\\\share\\vol1']);
    const nfsSpy = jest.spyOn(nfsProtocol, 'validateConnection');

    const result = await activity.validate(
      'trace-003',
      'SMB',
      { hostname: '192.168.1.1' },
      { enablePreListPath: true, enableVersionFetch: false },
    );

    expect(result.status).toBe('success');
    expect(smbProtocol.validateConnection).toHaveBeenCalled();
    // NFS must NOT have been called — confirms real routing logic works
    expect(nfsSpy).not.toHaveBeenCalled();
  });

  // ─── N1: validateConnection fails → returns error response (does not throw) ───

  it('N1 — validateConnection failure returns error status, does not throw', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockRejectedValue(
      new Error('Connection timed out to 10.0.0.1:2049'),
    );

    const result = await activity.validate(
      'trace-004',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: true, enableVersionFetch: true },
    );

    // Activity catches the error and returns error shape — does NOT throw
    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed to validate connection for 10.0.0.1');
    expect(result.message).toContain('Connection timed out to 10.0.0.1:2049');
    expect(result.paths).toEqual([]);
    expect(result.protocolVersions).toEqual([]);
  });

  // ─── N2: validateConnection succeeds but listPaths fails → error response ───

  it('N2 — listPaths failure after successful validateConnection returns error status', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue('Connection established');
    jest.spyOn(nfsProtocol, 'listPaths').mockRejectedValue(
      new Error('showmount: cannot access 10.0.0.1: RPC timed out'),
    );

    const result = await activity.validate(
      'trace-005',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: true, enableVersionFetch: false },
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('RPC timed out');
  });

  // ─── N3: validateConnection + listPaths succeed but getProtocolVersions fails ───

  it('N3 — getProtocolVersions failure returns error status', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue('Connection established');
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/src']);
    jest.spyOn(nfsProtocol, 'getProtocolVersions').mockRejectedValue(
      new Error('nfsstat command not found'),
    );

    const result = await activity.validate(
      'trace-006',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: true, enableVersionFetch: true },
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('nfsstat command not found');
  });

  // ─── N4: unsupported protocol type → Protocols.getProtocol throws ───

  it('N4 — unsupported protocol type causes Protocols.getProtocol to throw, returns error response', async () => {
    const result = await activity.validate(
      'trace-007',
      'FTP', // not in ProtocolTypes enum
      { hostname: '10.0.0.1' },
      { enablePreListPath: false, enableVersionFetch: false },
    );

    // Real Protocols.getProtocol default case throws — activity catches and returns error
    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed to validate connection');
    expect(result.message).toContain('Unsupported protocol');
  });

  // ─── N5: workerId is correctly included in both success and error responses ───

  it('N5 — workerId from real ConfigService is present in both success and error responses', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue('ok');

    const successResult = await activity.validate(
      'trace-008',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: false, enableVersionFetch: false },
    );
    expect(successResult.workerId).toBe('worker-1');

    jest.spyOn(nfsProtocol, 'validateConnection').mockRejectedValue(new Error('fail'));
    const errorResult = await activity.validate(
      'trace-009',
      'NFS',
      { hostname: '10.0.0.1' },
      { enablePreListPath: false, enableVersionFetch: false },
    );
    expect(errorResult.workerId).toBe('worker-1');
  });
});
