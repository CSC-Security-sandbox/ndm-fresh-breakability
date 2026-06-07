import { Test, TestingModule } from '@nestjs/testing';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { SetupExportsPathPermissionService } from '../activities/core/initializer/setup-exports-path-permission.service';
import { WinOperationService } from '../activities/core/migrate/command-execution/win-opeartions/win-operation.service';
import { RedisService } from '../redis/redis.service';

/**
 * Real classes wired:
 *   SetupExportsPathPermissionService.setupExportPathPermission
 *     → setup
 *       → WinOperationService.getAclOperation (boundary)
 *       → WinOperationService.mapSIDToTarget (boundary)
 *       → WinOperationService.setAclOperation (boundary)
 *       → WinOperationService.validateAclOperation (boundary)
 *
 * Mocked boundaries:
 *   WinOperationService — PowerShell ACL operations
 *   RedisService.getJobManagerContext — Redis
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const mockWinOperationService = {
  getAclOperation: jest.fn(),
  setAclOperation: jest.fn(),
  mapSIDToTarget: jest.fn(),
  validateAclOperation: jest.fn(),
};
const mockRedisService = {
  getJobManagerContext: jest.fn(),
  getOwnerIdentity: jest.fn(),
};

function makeSmbContext(preservePermissions = true, opts: { isIdentityMappingAvailable?: boolean } = {}) {
  return {
    jobConfig: {
      destinationFileServer: {
        hostname: 'dest-nas',
        path: '/share/dest',
        protocols: [{ type: 'SMB' }],
        pathId: 'dst-path',
      },
      sourceFileServer: {
        hostname: 'src-nas',
        path: '/share/src',
        protocols: [{ type: 'SMB' }],
        pathId: 'src-path',
      },
      options: { preservePermissions, isIdentityMappingAvailable: opts.isIdentityMappingAvailable ?? false },
      workerIds: ['worker-1'],
    },
    jobRunId: 'job-exp01',
    publishToTaskStream: jest.fn().mockResolvedValue(undefined),
    publishToErrorStream: jest.fn().mockResolvedValue(undefined),
  };
}

function makeNfsContext() {
  return {
    jobConfig: {
      destinationFileServer: {
        hostname: 'dest-nas',
        path: '/vol/dest',
        protocols: [{ type: 'NFS' }],
      },
      sourceFileServer: {
        hostname: 'src-nas',
        path: '/vol/src',
        protocols: [{ type: 'NFS' }],
      },
      options: { preservePermissions: false },
    },
  };
}

function makeAcl(owner: string, group: string, aces: any[] = []) {
  return {
    Owner: owner,
    Group: group,
    DaclAces: aces,
    Attributes: 'Directory',
    DaclPresent: true,
    DaclProtected: false,
    DaclAutoInherit: true,
    originalOwner: owner,
    originalGroup: group,
  };
}

describe('Component: setupExportPathPermission (SetupExportsPathPermissionService)', () => {
  let service: SetupExportsPathPermissionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupExportsPathPermissionService,
        { provide: LoggerFactory,        useValue: mockLoggerFactory },
        { provide: WinOperationService,  useValue: mockWinOperationService },
        { provide: RedisService,         useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<SetupExportsPathPermissionService>(SetupExportsPathPermissionService);
  });

  // ─── H1 ─────────────────────────────────────────────────────────────────────

  it('H1 — Protocol is not SMB: setupExportPathPermission reads the job config from Redis, sees the destination protocol is NFS, logs and returns immediately without calling WinOperationService at all', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeNfsContext());

    await service.setupExportPathPermission('job-exp01');

    expect(mockWinOperationService.getAclOperation).not.toHaveBeenCalled();
  });

  // ─── H2 ─────────────────────────────────────────────────────────────────────

  it('H2 — preservePermissions is disabled: same early-return — Redis is read but WinOperationService is never called', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeSmbContext(false));

    await service.setupExportPathPermission('job-exp02');

    expect(mockWinOperationService.getAclOperation).not.toHaveBeenCalled();
  });

  // ─── H3 ─────────────────────────────────────────────────────────────────────

  it('H3 — Full happy path: protocol is SMB, permissions enabled — verify getAclOperation is called for source, setAclOperation stamps ACL on destination, getAclOperation re-reads destination, and validateAclOperation confirms match', async () => {
    mockRedisService.getJobManagerContext.mockResolvedValue(makeSmbContext(true));

    const sourceAcl = makeAcl('DOMAIN\\alice', 'DOMAIN\\users', [
      { Sid: 'S-1-5-21-111', AccessMask: 2032127, AceType: 'AccessAllowed' },
    ]);
    const destAcl = makeAcl('DOMAIN\\alice', 'DOMAIN\\users', [
      { Sid: 'S-1-5-21-111', AccessMask: 2032127, AceType: 'AccessAllowed' },
    ]);

    mockWinOperationService.getAclOperation
      .mockResolvedValueOnce(sourceAcl)
      .mockResolvedValueOnce(destAcl);
    mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}', stderr: '' });
    mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

    await service.setupExportPathPermission('job-exp03');

    expect(mockWinOperationService.getAclOperation).toHaveBeenCalledTimes(2);
    expect(mockWinOperationService.setAclOperation).toHaveBeenCalledWith(
      expect.stringContaining('dest-nas'),
      sourceAcl,
      expect.any(String),
    );
    expect(mockWinOperationService.validateAclOperation).toHaveBeenCalledWith(
      sourceAcl, destAcl, expect.any(Object),
    );
  });

  // ─── H4 ─────────────────────────────────────────────────────────────────────

  it('H4 — SID mapping: isIdentityMappingAvailable is true — verify mapSIDToTarget is called with the source ACL and the mapped result is passed to setAclOperation', async () => {
    const ctx = makeSmbContext(true, { isIdentityMappingAvailable: true });
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const sourceAcl = makeAcl('S-1-5-21-SOURCE-OWNER', 'S-1-5-21-SOURCE-GROUP', [
      { Sid: 'S-1-5-21-SOURCE-ACE', AccessMask: 2032127, AceType: 'AccessAllowed' },
    ]);
    const mappedAcl = makeAcl('S-1-5-21-DEST-OWNER', 'S-1-5-21-DEST-GROUP', [
      { Sid: 'S-1-5-21-DEST-ACE', AccessMask: 2032127, AceType: 'AccessAllowed' },
    ]);
    const destAcl = { ...mappedAcl };

    mockWinOperationService.getAclOperation
      .mockResolvedValueOnce(sourceAcl)
      .mockResolvedValueOnce(destAcl);
    mockWinOperationService.mapSIDToTarget.mockResolvedValue(mappedAcl);
    mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}', stderr: '' });
    mockWinOperationService.validateAclOperation.mockResolvedValue({ sourceSID: '', targetSID: '', inValid: '' });

    await service.setupExportPathPermission('job-exp-h4');

    expect(mockWinOperationService.mapSIDToTarget).toHaveBeenCalledWith(sourceAcl, expect.any(String));
    expect(mockWinOperationService.setAclOperation).toHaveBeenCalledWith(
      expect.stringContaining('dest-nas'),
      mappedAcl,
      expect.any(String),
    );
  });

  // ─── N1 ─────────────────────────────────────────────────────────────────────

  it('N1 — setAclOperation reports unresolved SIDs and success=false: the error is caught, published to error stream, and does not crash the process', async () => {
    const ctx = makeSmbContext(true);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const sourceAcl = makeAcl('DOMAIN\\alice', 'DOMAIN\\users');
    mockWinOperationService.getAclOperation.mockResolvedValueOnce(sourceAcl);
    mockWinOperationService.setAclOperation.mockResolvedValue({
      stdout: '{"success":false,"error":"Kernel stamp failed","unresolved_sids":["S-1-5-21-UNKNOWN"]}',
      stderr: '',
    });

    await expect(service.setupExportPathPermission('job-exp-n1')).resolves.toBeUndefined();

    expect((ctx as any).publishToErrorStream).toHaveBeenCalled();
  });

  // ─── N2 ─────────────────────────────────────────────────────────────────────

  it('N2 — validateAclOperation finds a mismatch: the mismatch is treated as an error, published to error stream', async () => {
    const ctx = makeSmbContext(true);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const sourceAcl = makeAcl('DOMAIN\\alice', 'DOMAIN\\users');
    const destAcl = makeAcl('DOMAIN\\bob', 'DOMAIN\\users');

    mockWinOperationService.getAclOperation
      .mockResolvedValueOnce(sourceAcl)
      .mockResolvedValueOnce(destAcl);
    mockWinOperationService.setAclOperation.mockResolvedValue({ stdout: '{"success":true}', stderr: '' });
    mockWinOperationService.validateAclOperation.mockResolvedValue({
      sourceSID: '', targetSID: '', inValid: 'Owner mismatch: Expected(DOMAIN\\alice) Target(DOMAIN\\bob)',
    });

    await expect(service.setupExportPathPermission('job-exp-n2')).resolves.toBeUndefined();

    expect((ctx as any).publishToErrorStream).toHaveBeenCalled();
  });

  // ─── N3 ─────────────────────────────────────────────────────────────────────

  it('N3 — getAclOperation for source throws: the error propagates through setup and is caught by the outer try/catch and published to error stream', async () => {
    const ctx = makeSmbContext(true);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    mockWinOperationService.getAclOperation.mockRejectedValue(
      new Error('Failed to get ACL for source: connection refused'),
    );

    await expect(service.setupExportPathPermission('job-exp-n3')).resolves.toBeUndefined();

    expect((ctx as any).publishToErrorStream).toHaveBeenCalled();
  });

  // ─── N4 ─────────────────────────────────────────────────────────────────────

  it('N4 — getJobManagerContext itself fails: the error propagates up since it is outside the setup() try/catch', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(
      new Error('Redis unavailable'),
    );

    await expect(service.setupExportPathPermission('job-exp-n4')).rejects.toThrow(
      'Redis unavailable',
    );
  });
});
