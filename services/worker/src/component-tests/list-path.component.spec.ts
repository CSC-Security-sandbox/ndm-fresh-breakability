import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ListPathActivity } from '../activities/list-path/list-path.service';
import { ExportPathSource } from '../activities/list-path/list-path.type';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';

/**
 * Real classes wired together:
 *   ListPathActivity → Protocols → NFSProtocol / SMBProtocol
 *
 * Mocked boundaries:
 *   NFSProtocol.listPaths  (real shell exec — showmount -e)
 *   SMBProtocol.listPaths  (real shell exec / mount)
 *   ConfigService
 *
 * What this covers beyond the existing unit test:
 *   - The UT mocks the entire Protocols class (jest.mock('src/protocols/protocols')),
 *     so the real getProtocol() switch is never called.  An unsupported protocol
 *     string (the UT uses 'FTP') would silently succeed instead of throwing.
 *   - The MANUAL_UPLOAD short-circuit branch (line 38 of the service) is never
 *     reached in the UT because payload has no exportPathSource field — the
 *     condition evaluates to true and listPaths is always called.
 *   - This test wires real Protocols + real NFSProtocol/SMBProtocol so:
 *       (a) NFS/SMB routing through the real switch is exercised
 *       (b) MANUAL_UPLOAD branch is confirmed to skip listPaths entirely
 *       (c) error propagation from real protocol boundary is verified
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

describe('Component: listPath (ListPathActivity)', () => {
  let activity: ListPathActivity;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        'worker.workerId': 'worker-1',
        'worker.baseMountDir': '/mnt',
        'worker.platform': 'linux',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // WorkersConfig is a static singleton consumed by Protocol base class
    // constructor. Must be initialised before NFSProtocol/SMBProtocol are created.
    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListPathActivity, // REAL
        Protocols,        // REAL — routes NFS/SMB via switch
        NFSProtocol,      // REAL class, boundary methods mocked per test
        SMBProtocol,      // REAL class, boundary methods mocked per test
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    activity    = module.get<ListPathActivity>(ListPathActivity);
    nfsProtocol = module.get<NFSProtocol>(NFSProtocol);
    smbProtocol = module.get<SMBProtocol>(SMBProtocol);
  });

  // ─── H1: NFS AUTO_DISCOVER — routes to NFSProtocol, paths returned ───

  it('H1 — NFS AUTO_DISCOVER: real Protocols routes to NFSProtocol and paths are returned', async () => {
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/src', '/vol/dest']);

    const result = await activity.listPath(
      'trace-001',
      'NFS',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );

    expect(nfsProtocol.listPaths).toHaveBeenCalledWith(
      'trace-001',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );
    expect(result.status).toBe('success');
    expect(result.paths).toEqual(['/vol/src', '/vol/dest']);
    expect(result.workerId).toBe('worker-1');
  });

  // ─── H2: SMB AUTO_DISCOVER — routes to SMBProtocol, not NFSProtocol ───

  it('H2 — SMB AUTO_DISCOVER: real Protocols routes to SMBProtocol; NFSProtocol is never called', async () => {
    jest.spyOn(smbProtocol, 'listPaths').mockResolvedValue(['\\\\share\\vol1', '\\\\share\\vol2']);
    const nfsSpy = jest.spyOn(nfsProtocol, 'listPaths');

    const result = await activity.listPath(
      'trace-002',
      'SMB',
      { hostname: '192.168.1.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );

    expect(result.status).toBe('success');
    expect(result.paths).toEqual(['\\\\share\\vol1', '\\\\share\\vol2']);
    // Confirms the real routing switch sent traffic to SMB, not NFS
    expect(nfsSpy).not.toHaveBeenCalled();
    expect(smbProtocol.listPaths).toHaveBeenCalled();
  });

  // ─── H3: MANUAL_UPLOAD — skips protocol call entirely, returns success with empty paths ───

  it('H3 — MANUAL_UPLOAD: listPaths is never called; returns success with empty paths', async () => {
    const nfsSpy = jest.spyOn(nfsProtocol, 'listPaths');
    const smbSpy = jest.spyOn(smbProtocol, 'listPaths');

    const result = await activity.listPath(
      'trace-003',
      'NFS',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.MANUAL_UPLOAD },
    );

    // The MANUAL_UPLOAD branch returns early — no protocol call at all
    expect(result.status).toBe('success');
    expect(result.paths).toEqual([]);
    expect(nfsSpy).not.toHaveBeenCalled();
    expect(smbSpy).not.toHaveBeenCalled();
  });

  // ─── H4: no exportPathSource in payload → treated as non-MANUAL_UPLOAD, listPaths called ───

  it('H4 — exportPathSource absent: defaults to calling listPaths (undefined !== MANUAL_UPLOAD)', async () => {
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/data']);

    const result = await activity.listPath(
      'trace-004',
      'NFS',
      { hostname: '10.0.0.1' }, // no exportPathSource field
    );

    // undefined !== 'MANUAL_UPLOAD' → condition is truthy → listPaths is called
    expect(nfsProtocol.listPaths).toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.paths).toEqual(['/vol/data']);
  });

  // ─── N1: listPaths throws → returns error response, does not rethrow ───

  it('N1 — listPaths failure returns error status and does not throw', async () => {
    jest.spyOn(nfsProtocol, 'listPaths').mockRejectedValue(
      new Error('showmount: cannot access 10.0.0.1: RPC timed out'),
    );

    const result = await activity.listPath(
      'trace-005',
      'NFS',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed to List Path for 10.0.0.1');
    expect(result.message).toContain('RPC timed out');
    expect(result.paths).toEqual([]);
    expect(result.workerId).toBe('worker-1');
  });

  // ─── N2: unsupported protocol type → real Protocols.getProtocol throws ───

  it('N2 — unsupported protocol type causes Protocols.getProtocol to throw, returns error response', async () => {
    const result = await activity.listPath(
      'trace-006',
      'FTP', // not in ProtocolTypes enum
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );

    // Real Protocols.getProtocol default case throws — activity catches and wraps it
    expect(result.status).toBe('error');
    expect(result.message).toContain('Failed to List Path for 10.0.0.1');
    expect(result.message).toContain('Unsupported protocol type: undefined');
  });

  // ─── N3: workerId is stamped on both success and error responses ───

  it('N3 — workerId from ConfigService is present in both success and error responses', async () => {
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/src']);
    const success = await activity.listPath(
      'trace-007',
      'NFS',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );
    expect(success.workerId).toBe('worker-1');

    jest.spyOn(nfsProtocol, 'listPaths').mockRejectedValue(new Error('fail'));
    const error = await activity.listPath(
      'trace-008',
      'NFS',
      { hostname: '10.0.0.1', exportPathSource: ExportPathSource.AUTO_DISCOVER },
    );
    expect(error.workerId).toBe('worker-1');
  });
});
