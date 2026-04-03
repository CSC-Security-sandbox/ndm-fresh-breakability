import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrecheckActivity } from './precheck-activity';
import { Protocols } from 'src/protocols/protocols';
import { PreCheckErrorCodes, PreCheckStatus, ServerCredential, Settings, WorkerTaskPaths } from 'src/workflows/pre-check/pre-check.types';
import { ExportPathSource } from '../list-path/list-path.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { SMBProtocol } from '../../protocols/smb/smb.protocol';
import { NFSProtocol } from '../../protocols/nfs/nfs.protocol';
import { mockLoggerFactory } from '../../auth/auth.service.spec';
import { WorkersConfig } from 'src/config/app.config';
import { CommandConfig } from 'src/config/command.config';

let loggerFactory: LoggerFactory;
let protocols: Protocols;

jest.mock('fs', () => ({
  promises: {
    open: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    readdir: jest.fn(),
  },
}));

jest.mock('src/protocols/protocols');
jest.mock('@temporalio/worker', () => ({
  Worker: jest.fn(),
}));
describe('PrecheckActivity', () => {
  let service: PrecheckActivity;
  let mockConfigService: Partial<ConfigService>;
  let logger: LoggerService;
  let mockProtocol: any;

  const mockTraceId = 'test-trace-id';
  const mockSettings: Settings = {
    preserveAccessTime: true,
  };
  const mockServerCredential: ServerCredential = {
    host: 'test-host',
    userName: 'test-user',
    password: 'test-pass',
    protocol: 'SFTP',
    protocolVersion: '1',
    id: '',
    serverType: '',
    exportPathSource: ExportPathSource.AUTO_DISCOVER
  };
  const mockSourcePath: WorkerTaskPaths = {
    pathId: 'source-path-id',
    pathName: '/source/path',
    isSource: true,
    serverId: ''
  };
  const mockDestinationPath: WorkerTaskPaths = {
    pathId: 'dest-path-id',
    pathName: '/dest/path',
    isSource: false,
    serverId: ''
  };

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'worker.workerId':
            return 'test-worker-id';
          case 'worker.baseWorkingPath':
            return '/base/working/path';
          default:
            return null;
        }
      }),
    };

    WorkersConfig.configService = mockConfigService as ConfigService;
    CommandConfig.configService = mockConfigService as ConfigService;

    loggerFactory = {
        create: jest.fn().mockReturnValue({
        log: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
      }),
    } as any;

    logger = loggerFactory.create(PrecheckActivity.name); 

    protocols = new Protocols(
      new NFSProtocol(loggerFactory),
      new SMBProtocol(loggerFactory)
    );

    mockProtocol = {
      validateConnection: jest.fn().mockResolvedValue(true),
      mountPath: jest.fn().mockResolvedValue(true),
      listPaths: jest.fn().mockResolvedValue([]),
      getTotalUsedMemory: jest.fn().mockResolvedValue(0),
      getAvailableDiskSpace: jest.fn().mockResolvedValue({ size: 0 }),
      unmountPath: jest.fn().mockResolvedValue(true),
    };

    (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrecheckActivity,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: LoggerFactory,
          useValue: loggerFactory,
        },
        { provide: Protocols, useValue: protocols },
      ],
    }).compile();

    service = module.get<PrecheckActivity>(PrecheckActivity);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('preCheckPath', () => {
    it('should successfully pre-check a source path', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/source/path']);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(1024);
      mockProtocol.unmountPath.mockResolvedValue(true);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);
      (service as any).shouldCheckDiskSpace = true;

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(result.errorCodes).toHaveLength(0);
      expect(result.sourceDataSize).toBe(1024);
    });

    it('should handle mount failure for source path', async () => {
      mockProtocol.validateConnection.mockRejectedValue(new Error('Connection failed'));

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error mounting path')
      );
    });

    it('should handle mount failure for destination path', async () => {
      mockProtocol.validateConnection.mockRejectedValue(new Error('Connection failed'));

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockDestinationPath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.DESTINATION_PATH_MOUNT_FAILED);
    });

    it('should skip test file operations when not preserving access time for source', async () => {
      const settingsWithoutPreserve: Settings = {
        preserveAccessTime: false,
      };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/source/path']);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(1024);

      const fs = require('fs').promises;
      const openSpy = jest.spyOn(fs, 'open');

      const result = await service.preCheckPath(
        settingsWithoutPreserve,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(openSpy).not.toHaveBeenCalled();
    });

    it('should always perform test file operations for destination', async () => {
      const settingsWithoutPreserve: Settings = {
        preserveAccessTime: false,
      };

      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/dest/path']);
      mockProtocol.getAvailableDiskSpace.mockResolvedValue({ size: 2048 });

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([]);

      const result = await service.preCheckPath(
        settingsWithoutPreserve,
        mockServerCredential,
        mockDestinationPath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.SUCCESS);
      expect(fs.open).toHaveBeenCalled();
    });

    it('should handle source data size calculation failure', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/source/path']);
      mockProtocol.getTotalUsedMemory.mockRejectedValue(new Error('Size calc failed'));

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);
      (service as any).shouldCheckDiskSpace = true;
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.sourceDataSize).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error while calculating source data size')
      );
    });

    it('should handle destination space check failure', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/dest/path']);
      mockProtocol.getAvailableDiskSpace.mockRejectedValue(new Error('Space check failed'));

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);
      fs.readdir.mockResolvedValue([]);
      (service as any).shouldCheckDiskSpace = true;
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockDestinationPath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.destinationAvailableSpace).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error while calculating destination available space')
      );
    });


    it('should handle unmount failure', async () => {
      mockProtocol.validateConnection.mockResolvedValue(true);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue(['/source/path']);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(1024);
      mockProtocol.unmountPath.mockRejectedValue(new Error('Unmount failed'));

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error unmounting path')
      );
    });

    it('should handle path not found for source', async () => {
      mockProtocol.listPaths.mockResolvedValue(['/other/path']);
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );
      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    });

    it('should handle path not found for destination', async () => {
      mockProtocol.listPaths.mockResolvedValue(['/other/path']);
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockDestinationPath,
        mockTraceId
      );
      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.DESTINATION_PATH_NOT_FOUND);
    });
    it('should handle list paths failure', async () => {
      mockProtocol.listPaths.mockRejectedValue(new Error('List failed'));
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );
      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND);
    });

    it('should handle no space left on device', async () => {
      const fs = require('fs').promises;
      fs.open.mockRejectedValue({ code: 'ENOSPC' });
      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.NO_SPACE_LEFT_ON_SOURCE_PATH);
    });

    it('should handle write permission failure', async () => {
      const fs = require('fs').promises;
      fs.open.mockRejectedValue(new Error('Permission denied'));

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_WRITE_PERMISSION_FAILED);
    });
  });

  it('should call getTotalUsedMemory if discoveredSize is undefined', async () => {
    const testPath = { ...mockSourcePath, discoveredSize: undefined };
    mockProtocol.getTotalUsedMemory.mockResolvedValue(1000);
    (service as any).shouldCheckDiskSpace = true;

    const result = await service.preCheckPath(
      mockSettings,
      mockServerCredential,
      testPath,
      mockTraceId
    );

    expect(mockProtocol.getTotalUsedMemory).toHaveBeenCalled();
    expect(result.sourceDataSize).toBe(1000);
  });

  it('should call getTotalUsedMemory if discoveredSize is null', async () => {
    const testPath = { ...mockSourcePath, discoveredSize: null };
    mockProtocol.getTotalUsedMemory.mockResolvedValue(1000);
    (service as any).shouldCheckDiskSpace = true;
    const result = await service.preCheckPath(
      mockSettings,
      mockServerCredential,
      testPath,
      mockTraceId
    );

    expect(mockProtocol.getTotalUsedMemory).toHaveBeenCalled();
    expect(result.sourceDataSize).toBe(1000);
  });

  it('should call getTotalUsedMemory if discoveredSize is negative', async () => {
    const testPath = { ...mockSourcePath, discoveredSize: -1 };
    mockProtocol.getTotalUsedMemory.mockResolvedValue(1000);
    (service as any).shouldCheckDiskSpace = true;
    const result = await service.preCheckPath(
      mockSettings,
      mockServerCredential,
      testPath,
      mockTraceId
    );

    expect(mockProtocol.getTotalUsedMemory).toHaveBeenCalled();
    expect(result.sourceDataSize).toBe(1000);
  });

  it('should NOT call getTotalUsedMemory if discoveredSize is 0', async () => {
    const testPath = { ...mockSourcePath, discoveredSize: 0 };
    (service as any).shouldCheckDiskSpace = true;
    const result = await service.preCheckPath(
      mockSettings,
      mockServerCredential,
      testPath,
      mockTraceId
    );

    expect(mockProtocol.getTotalUsedMemory).not.toHaveBeenCalled();
    expect(result.sourceDataSize).toBe(null);
  });

  it('should NOT call getTotalUsedMemory if discoveredSize is positive', async () => {
    const testPath = { ...mockSourcePath, discoveredSize: 4567 };
    (service as any).shouldCheckDiskSpace = true;

    const result = await service.preCheckPath(
      mockSettings,
      mockServerCredential,
      testPath,
      mockTraceId
    );
    expect(mockProtocol.getTotalUsedMemory).not.toHaveBeenCalled();
    expect(result.sourceDataSize).toBe(4567);
  });

  // --- Warning propagation from validateConnection ---

  describe('warning propagation from validateConnection', () => {
    it('should store BACKUP_OPERATORS_CHECK_SKIPPED warning when validateConnection returns it', async () => {
      mockProtocol.validateConnection.mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'],
      });
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(1024);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED]);
      expect(result.status).toBe(PreCheckStatus.SUCCESS);
    });

    it('should store BACKUP_OPERATORS_NOT_MEMBER warning when validateConnection returns it', async () => {
      mockProtocol.validateConnection.mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_NOT_MEMBER'],
      });
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(512);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER]);
    });

    it('should store multiple warnings when validateConnection returns several', async () => {
      mockProtocol.validateConnection.mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED', 'BACKUP_OPERATORS_NOT_MEMBER'],
      });
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(512);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toEqual([
        PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED,
        PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER,
      ]);
    });

    it('should not set warnings when validateConnection returns empty warnings array', async () => {
      mockProtocol.validateConnection.mockResolvedValue({ warnings: [] });
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(512);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toBeUndefined();
    });

    it('should not set warnings when validateConnection returns undefined', async () => {
      mockProtocol.validateConnection.mockResolvedValue(undefined);
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(512);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toBeUndefined();
    });

    it('should filter out unrecognised warning codes that are not in PreCheckErrorCodes', async () => {
      mockProtocol.validateConnection.mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED', 'UNKNOWN_FUTURE_CODE'],
      });
      mockProtocol.mountPath.mockResolvedValue(true);
      mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
      mockProtocol.getTotalUsedMemory.mockResolvedValue(512);

      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED]);
      expect(result.warnings).not.toContain('UNKNOWN_FUTURE_CODE');
    });

    it('should still fail with mount error even when validateConnection returned warnings', async () => {
      mockProtocol.validateConnection.mockResolvedValue({
        warnings: ['BACKUP_OPERATORS_NOT_MEMBER'],
      });
      mockProtocol.mountPath.mockRejectedValue(new Error('Mount failed'));

      const result = await service.preCheckPath(
        mockSettings,
        mockServerCredential,
        mockSourcePath,
        mockTraceId
      );

      expect(result.status).toBe(PreCheckStatus.FAILED);
      expect(result.errorCodes).toContain(PreCheckErrorCodes.SOURCE_PATH_MOUNT_FAILED);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test plan: end-to-end precheck scenarios for each domain/membership state
  // ───────────────────────────────────────────────────────────────────────────

  describe('precheck job — Backup Operators group check scenarios', () => {
    const setupFsForSuccess = () => {
      const fs = require('fs').promises;
      fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
      fs.readFile.mockResolvedValue('test');
      fs.unlink.mockResolvedValue(true);
    };

    // ── Scenario: worker NOT part of domain ────────────────────────────────

    describe('worker is NOT part of a domain', () => {
      it('should complete precheck with SUCCESS and set BACKUP_OPERATORS_CHECK_SKIPPED warning', async () => {
        // smb.protocol returns SKIPPED when machine is not domain-joined
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(2048);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockSourcePath,
          mockTraceId
        );

        // Precheck should proceed and succeed — warning is surfaced, not a failure
        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED]);
        expect(result.errorCodes).toHaveLength(0);
      });

      it('should still mount, list paths, and measure size even when not domain-joined', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(4096);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockSourcePath,
          mockTraceId
        );

        // All precheck operations run regardless of domain-join status
        expect(mockProtocol.mountPath).toHaveBeenCalled();
        expect(mockProtocol.listPaths).toHaveBeenCalled();
        expect(result.status).toBe(PreCheckStatus.SUCCESS);
      });

      it('should surface BACKUP_OPERATORS_CHECK_SKIPPED on a DESTINATION path precheck', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_CHECK_SKIPPED'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockDestinationPath.pathName]);
        mockProtocol.getAvailableDiskSpace.mockResolvedValue({ size: 10000 });
        mockProtocol.unmountPath.mockResolvedValue(true);

        const fs = require('fs').promises;
        fs.open.mockResolvedValue({ close: jest.fn().mockResolvedValue(true) });
        fs.readFile.mockResolvedValue('test');
        fs.unlink.mockResolvedValue(true);
        fs.readdir.mockResolvedValue([]);

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockDestinationPath,
          mockTraceId
        );

        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED]);
      });
    });

    // ── Scenario: worker IS domain-joined, user NOT in Backup Operators ──────

    describe('worker IS domain-joined — user NOT a Backup Operator', () => {
      it('should complete precheck with SUCCESS and set BACKUP_OPERATORS_NOT_MEMBER warning', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(1024);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockSourcePath,
          mockTraceId
        );

        // Precheck proceeds — user sees the warning but the job is not blocked at precheck
        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER]);
        expect(result.errorCodes).toHaveLength(0);
      });

      it('should still mount and validate the path even when user is not a Backup Operator', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(512);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        await service.preCheckPath(mockSettings, mockServerCredential, mockSourcePath, mockTraceId);

        // The warning is non-blocking — all steps still execute
        expect(mockProtocol.mountPath).toHaveBeenCalled();
        expect(mockProtocol.listPaths).toHaveBeenCalled();
        expect(mockProtocol.unmountPath).toHaveBeenCalled();
      });

      it('should not add errorCodes when user is not a Backup Operator (warning is not a hard failure)', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: ['BACKUP_OPERATORS_NOT_MEMBER'] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(512);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        const result = await service.preCheckPath(mockSettings, mockServerCredential, mockSourcePath, mockTraceId);

        expect(result.errorCodes).toHaveLength(0);
        expect(result.warnings).toEqual([PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER]);
      });
    });

    // ── Scenario: worker IS domain-joined, user IS in Backup Operators ───────

    describe('worker IS domain-joined — user IS a Backup Operator (correct setup)', () => {
      it('should complete precheck with SUCCESS and no warnings when user is a member', async () => {
        // smb.protocol returns { warnings: [] } when IS_MEMBER
        mockProtocol.validateConnection.mockResolvedValue({ warnings: [] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(8192);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockSourcePath,
          mockTraceId
        );

        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.warnings).toBeUndefined();
        expect(result.errorCodes).toHaveLength(0);
      });

      it('should run the full precheck lifecycle when user is correct', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: [] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(2048);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();
        (service as any).shouldCheckDiskSpace = true;

        const result = await service.preCheckPath(
          mockSettings,
          mockServerCredential,
          mockSourcePath,
          mockTraceId
        );

        // Every step runs: connect → mount → list → measure size → unmount
        expect(mockProtocol.validateConnection).toHaveBeenCalled();
        expect(mockProtocol.mountPath).toHaveBeenCalled();
        expect(mockProtocol.listPaths).toHaveBeenCalled();
        expect(mockProtocol.getTotalUsedMemory).toHaveBeenCalled();
        expect(mockProtocol.unmountPath).toHaveBeenCalled();
        expect(result.status).toBe(PreCheckStatus.SUCCESS);
        expect(result.sourceDataSize).toBe(2048);
      });

      it('should record correct sourceDataSize when IS_MEMBER and precheck is clean', async () => {
        mockProtocol.validateConnection.mockResolvedValue({ warnings: [] });
        mockProtocol.mountPath.mockResolvedValue(true);
        mockProtocol.listPaths.mockResolvedValue([mockSourcePath.pathName]);
        mockProtocol.getTotalUsedMemory.mockResolvedValue(999);
        mockProtocol.unmountPath.mockResolvedValue(true);
        setupFsForSuccess();
        (service as any).shouldCheckDiskSpace = true;

        const result = await service.preCheckPath(mockSettings, mockServerCredential, mockSourcePath, mockTraceId);

        expect(result.sourceDataSize).toBe(999);
        expect(result.warnings).toBeUndefined();
      });
    });
  });
});








