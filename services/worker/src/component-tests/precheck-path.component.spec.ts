import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrecheckActivity } from '../activities/precheck/precheck-activity';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import {
  PreCheckErrorCodes,
  PreCheckStatus,
  ServerCredential,
  Settings,
  WorkerTaskPaths,
} from '../workflows/pre-check/pre-check.types';
import { ExportPathSource } from '../activities/list-path/list-path.type';

jest.mock('fs', () => ({
  promises: {
    open:   jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
  },
}));
import * as fsPromises from 'fs';

/**
 * Real classes wired:
 *   PrecheckActivity → Protocols → NFSProtocol / SMBProtocol
 *
 * Mocked boundaries:
 *   NFSProtocol.validateConnection — TCP / NFS socket
 *   NFSProtocol.mountPath         — shell command
 *   NFSProtocol.listPaths         — showmount RPC
 *   NFSProtocol.unmountPath       — shell command
 *   fs.promises                   — file-system (write permission test file)
 *
 * preCheckPath always returns a result object — it never throws.
 * Error codes accumulate; status becomes FAILED if any are present.
 */

const mockLogger = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':          'worker-1',
      'worker.baseWorkingPath':   '/mnt/worker',
      'worker.checkSpaceForPreCheck': false,
    };
    return map[key];
  }),
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCredential(protocol = 'NFS', exportPathSource = ExportPathSource.AUTO_DISCOVER): ServerCredential {
  return {
    id: 'srv-1',
    host: '10.0.0.1',
    userName: 'admin',
    password: 'pass',
    protocol,
    protocolVersion: '3',
    serverType: 'NAS',
    exportPathSource,
  };
}

function makePaths(isSource = true): WorkerTaskPaths {
  return {
    pathId: 'pid-1',
    serverId: 'srv-1',
    pathName: '/vol/data',
    isSource,
  };
}

const settings: Settings = { preserveAccessTime: false, preservePermissions: false };
const settingsWithPreserveTime: Settings = { preserveAccessTime: true, preservePermissions: false };

// ─── test suite ───────────────────────────────────────────────────────────────

describe('Component: preCheckPath (PrecheckActivity)', () => {
  let activity: PrecheckActivity;
  let nfsProtocol: NFSProtocol;
  let smbProtocol: SMBProtocol;
  const fs = (fsPromises as any).promises;

  beforeEach(async () => {
    jest.clearAllMocks();

    new WorkersConfig(mockConfigService as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrecheckActivity,
        Protocols,
        NFSProtocol,
        SMBProtocol,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
      ],
    }).compile();

    activity    = module.get<PrecheckActivity>(PrecheckActivity);
    nfsProtocol = module.get<NFSProtocol>(NFSProtocol);
    smbProtocol = module.get<SMBProtocol>(SMBProtocol);
  });

  // ─── H1: NFS AUTO_DISCOVER full happy path ──────────────────────────────

  it('H1 — Full happy path for a source NFS path with AUTO_DISCOVER — connection tested, path mounted, exported path list fetched and the expected path is found in it, write-permission test file created and deleted, then path unmounted — verify empty error codes and status SUCCESS', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/data', '/vol/other']);
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const mockFileHandle = { close: jest.fn().mockResolvedValue(undefined) };
    fs.open.mockResolvedValue(mockFileHandle);
    fs.readFile.mockResolvedValue('');
    fs.unlink.mockResolvedValue(undefined);

    const result = await activity.preCheckPath(
      settingsWithPreserveTime,
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-1',
    );

    expect(nfsProtocol.validateConnection).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.mountPath).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.listPaths).toHaveBeenCalledTimes(1);
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
    expect(fs.open).toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalled();
    expect(result.status).toBe(PreCheckStatus.SUCCESS);
    expect(result.errorCodes).toHaveLength(0);
    expect(result.workerId).toBe('worker-1');
  });

  // ─── H2: MANUAL_UPLOAD — listPaths never called ──────────────────────────

  it('H2 — MANUAL_UPLOAD is set — verify listPaths is never called even after a successful mount, so the path-existence check is skipped entirely', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);
    const listSpy = jest.spyOn(nfsProtocol, 'listPaths');

    const result = await activity.preCheckPath(
      settings,
      makeCredential('NFS', ExportPathSource.MANUAL_UPLOAD),
      makePaths(true),
      'trace-2',
    );

    expect(listSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(PreCheckStatus.SUCCESS);
  });

  // ─── H3: SMB — real routing switch sends calls to SMBProtocol ────────────

  it('H3 — SMB protocol — verify the real routing switch sends all calls to SMBProtocol and NFSProtocol is never touched', async () => {
    jest.spyOn(smbProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(smbProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(smbProtocol, 'listPaths').mockResolvedValue(['/vol/data']);
    jest.spyOn(smbProtocol, 'unmountPath').mockResolvedValue(undefined);
    const nfsSpy = jest.spyOn(nfsProtocol, 'validateConnection');

    const result = await activity.preCheckPath(
      settings,
      makeCredential('SMB', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-3',
    );

    expect(smbProtocol.validateConnection).toHaveBeenCalledTimes(1);
    expect(nfsSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(PreCheckStatus.SUCCESS);
  });

  // ─── N1: mount fails → MOUNT_FAILED error code, no subsequent checks ─────

  it('N1 — The TCP connection or the mount command fails — verify MOUNT_FAILED error code is added to the output, all subsequent checks (listPaths, write test, unmount) are skipped, and the activity still returns a result instead of throwing', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockRejectedValue(new Error('connection refused'));
    jest.spyOn(nfsProtocol, 'mountPath').mockRejectedValue(new Error('mount failed'));
    const listSpy  = jest.spyOn(nfsProtocol, 'listPaths');
    const unmountSpy = jest.spyOn(nfsProtocol, 'unmountPath');

    const result = await activity.preCheckPath(
      settings,
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-n1',
    );

    expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED);
    expect(result.status).toBe(PreCheckStatus.FAILED);
    // mount failed → subsequent checks skipped
    expect(listSpy).not.toHaveBeenCalled();
    expect(unmountSpy).not.toHaveBeenCalled();
  });

  // ─── N2: listPaths succeeds but path not in list → PATH_NOT_FOUND ────────

  it('N2 — Mount succeeds and listPaths returns a list, but the expected path is not in that list — verify PATH_NOT_FOUND error code is added and the final status is FAILED', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    // path '/vol/data' is NOT in the returned list
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/other', '/vol/another']);
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const result = await activity.preCheckPath(
      settings,
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-n2',
    );

    expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    expect(result.status).toBe(PreCheckStatus.FAILED);
    // unmount still ran (mount succeeded)
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
  });

  // ─── N3: listPaths throws → PATH_NOT_FOUND still added (catch handles it) ─

  it('N3 — listPaths itself throws an error — verify PATH_NOT_FOUND error code is still added (the .catch handles it) and other parallel checks like the write test still run', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'listPaths').mockRejectedValue(new Error('RPC timeout'));
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    const mockFileHandle = { close: jest.fn().mockResolvedValue(undefined) };
    fs.open.mockResolvedValue(mockFileHandle);
    fs.readFile.mockResolvedValue('');
    fs.unlink.mockResolvedValue(undefined);

    const result = await activity.preCheckPath(
      settingsWithPreserveTime,
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-n3',
    );

    expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    expect(fs.open).toHaveBeenCalled();
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
  });

  // ─── N4: write permission test fails → WRITE_PERMISSION error code ────────

  it('N4 — Write permission test fails with an access denied error — verify WRITE_PERMISSION_FAILED error code is added, the remaining checks still complete, and the unmount still runs', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/data']);
    jest.spyOn(nfsProtocol, 'unmountPath').mockResolvedValue(undefined);

    // Write test file fails with EACCES — real preCheckPath catches this inside the async IIFE
    fs.open.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    const result = await activity.preCheckPath(
      settingsWithPreserveTime, // preserveAccessTime=true triggers write test on source
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-n4',
    );

    expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED);
    expect(result.status).toBe(PreCheckStatus.FAILED);
    // unmount still ran after write test failure
    expect(nfsProtocol.unmountPath).toHaveBeenCalledTimes(1);
  });

  // ─── N5: all checks pass but unmount fails → UNMOUNT_FAILED ───────────────

  it('N5 — All checks pass but the unmount at the end fails — verify UNMOUNT_FAILED error code is added and the final status is FAILED even though everything else succeeded', async () => {
    jest.spyOn(nfsProtocol, 'validateConnection').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'mountPath').mockResolvedValue(undefined);
    jest.spyOn(nfsProtocol, 'listPaths').mockResolvedValue(['/vol/data']);
    jest.spyOn(nfsProtocol, 'unmountPath').mockRejectedValue(new Error('device busy'));

    const result = await activity.preCheckPath(
      settings,
      makeCredential('NFS', ExportPathSource.AUTO_DISCOVER),
      makePaths(true),
      'trace-n5',
    );

    expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_UNMOUNT_FAILED);
    expect(result.status).toBe(PreCheckStatus.FAILED);
  });
});
