import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, In } from 'typeorm';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from 'fs';
import * as path from 'path';
import { UpgradeService } from './upgrade.service';
import { WorkerEntity } from '../entities/worker.entity';
import { UpgradeBundleStatus } from '../constants/worker.enums';
import { WorkflowService } from '../workflow/workflow.service';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';

jest.mock('fs');
jest.mock('uuid', () => ({ v4: () => 'test-trace-id' }));

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('UpgradeService', () => {
  let service: UpgradeService;
  let workerRepository: Repository<WorkerEntity>;
  let workflowService: WorkflowService;

  const mockWorkflowService = {
    startWorkflow: jest.fn(),
    getWorkflowStatus: jest.fn(),
    terminateWorkflow: jest.fn(),
  };

  const mockWorkers: Partial<WorkerEntity>[] = [
    { workerId: 'worker-1', status: 'Online', platform: 'linux', upgradeBundleStaged: UpgradeBundleStatus.IDLE },
    { workerId: 'worker-2', status: 'Online', platform: 'windows', upgradeBundleStaged: UpgradeBundleStatus.IDLE },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    resetLoggerMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradeService,
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            find: jest.fn(),
            update: jest.fn(),
          },
        },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    service = module.get<UpgradeService>(UpgradeService);
    workerRepository = module.get<Repository<WorkerEntity>>(getRepositoryToken(WorkerEntity));
    workflowService = module.get<WorkflowService>(WorkflowService);
  });

  // ===========================================================================
  // sanitizeVersion (tested via cpBundlePath / validateBundlesExist)
  // ===========================================================================

  describe('Version Validation', () => {
    it('should reject version with path traversal characters', () => {
      expect(() => (service as any).sanitizeVersion('../etc/passwd')).toThrow(BadRequestException);
      expect(() => (service as any).sanitizeVersion('foo/bar')).toThrow(BadRequestException);
      expect(() => (service as any).sanitizeVersion('foo\\bar')).toThrow(BadRequestException);
      expect(() => (service as any).sanitizeVersion('')).toThrow(BadRequestException);
      expect(() => (service as any).sanitizeVersion('ver;rm -rf /')).toThrow(BadRequestException);
    });

    it('should accept valid version strings', () => {
      expect((service as any).sanitizeVersion('2026.02.10185052-nightly')).toBe('2026.02.10185052-nightly');
      expect((service as any).sanitizeVersion('preview-1')).toBe('preview-1');
      expect((service as any).sanitizeVersion('2026.02.10_hotfix')).toBe('2026.02.10_hotfix');
    });
  });

  // ===========================================================================
  // Platform Validation
  // ===========================================================================

  describe('Platform Validation', () => {
    it('should reject invalid platform', () => {
      expect(() => (service as any).cpBundlePath('1.0.0', 'macos')).toThrow(BadRequestException);
      expect(() => (service as any).cpBundlePath('1.0.0', '../etc')).toThrow(BadRequestException);
    });

    it('should accept linux and windows platforms', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const linuxPath = (service as any).cpBundlePath('1.0.0', 'linux');
      const windowsPath = (service as any).cpBundlePath('1.0.0', 'windows');
      expect(linuxPath).toContain('1.0.0');
      expect(linuxPath).toContain('linux');
      expect(windowsPath).toContain('windows');
    });
  });

  // ===========================================================================
  // startMulticast
  // ===========================================================================

  describe('startMulticast', () => {
    it('should fail precheck when no bundles exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      await expect(
        service.startMulticast({ version: '1.0.0' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return error when no active workers found', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-linux-1.0.0.tar.gz' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 100 } as any);
      jest.spyOn(workerRepository, 'find').mockResolvedValue([]);

      const result = await service.startMulticast({ version: '1.0.0' });

      expect(result.status).toBe('error');
      expect(result.message).toBe('No active workers found');
    });

    it('should start multicast workflow for active workers', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-linux-1.0.0.tar.gz' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 100 } as any);
      jest.spyOn(workerRepository, 'find').mockResolvedValue(mockWorkers as WorkerEntity[]);
      jest.spyOn(workerRepository, 'update').mockResolvedValue(undefined as any);
      mockWorkflowService.startWorkflow.mockResolvedValue({
        workflowId: 'BinaryMulticast-test-trace-id',
        firstExecutionRunId: 'run-1',
      });

      const result = await service.startMulticast({ version: '1.0.0' });

      expect(result.status).toBe('started');
      expect(result.workflowId).toBe('BinaryMulticast-test-trace-id');
      expect(workerRepository.update).toHaveBeenCalledWith(
        { workerId: In(['worker-1', 'worker-2']) },
        { upgradeBundleStaged: UpgradeBundleStatus.IN_PROGRESS },
      );
      expect(mockWorkflowService.startWorkflow).toHaveBeenCalledWith(
        'BinaryMulticastWorkflow',
        expect.objectContaining({
          taskQueue: 'ParentWorkflow-TaskQueue',
          args: [expect.objectContaining({
            workerIds: ['worker-1', 'worker-2'],
            version: '1.0.0',
          })],
        }),
      );
    });

    it('should return error when workflow service fails', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-linux-1.0.0.tar.gz' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 100 } as any);
      jest.spyOn(workerRepository, 'find').mockResolvedValue(mockWorkers as WorkerEntity[]);
      jest.spyOn(workerRepository, 'update').mockResolvedValue(undefined as any);
      mockWorkflowService.startWorkflow.mockRejectedValue(new Error('Temporal connection failed'));

      const result = await service.startMulticast({ version: '1.0.0' });

      expect(result.status).toBe('error');
      expect(result.message).toBe('Temporal connection failed');
    });
  });

  // ===========================================================================
  // acknowledgeWorkerDownload
  // ===========================================================================

  describe('acknowledgeWorkerDownload', () => {
    it('should set upgradeBundleStaged to COMPLETED on success', async () => {
      jest.spyOn(workerRepository, 'update').mockResolvedValue(undefined as any);

      const result = await service.acknowledgeWorkerDownload({
        workerId: 'worker-1',
        version: '1.0.0',
        status: 'success',
      });

      expect(result).toEqual({ acknowledged: true });
      expect(workerRepository.update).toHaveBeenCalledWith('worker-1', {
        upgradeBundleStaged: UpgradeBundleStatus.COMPLETED,
      });
    });

    it('should not update DB on failure status', async () => {
      const result = await service.acknowledgeWorkerDownload({
        workerId: 'worker-1',
        version: '1.0.0',
        status: 'failed',
        message: 'Checksum mismatch',
      });

      expect(result).toEqual({ acknowledged: true });
      expect(workerRepository.update).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // streamBundle
  // ===========================================================================

  describe('streamBundle', () => {
    it('should throw NotFoundException when directory does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      await expect(
        service.streamBundle('1.0.0', 'linux'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when bundle file not found', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([]);

      await expect(
        service.streamBundle('1.0.0', 'linux'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should stream linux tar.gz bundle', async () => {
      const mockStream = { pipe: jest.fn() };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-linux-1.0.0.tar.gz' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 1024 } as any);
      mockedFs.createReadStream.mockReturnValue(mockStream as any);

      const result = await service.streamBundle('1.0.0', 'linux');

      expect(result).toBeDefined();
      expect(result.getHeaders().disposition).toContain('datamigrator-worker-linux-1.0.0.tar.gz');
    });

    it('should stream windows zip bundle', async () => {
      const mockStream = { pipe: jest.fn() };
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-windows-1.0.0.zip' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 2048 } as any);
      mockedFs.createReadStream.mockReturnValue(mockStream as any);

      const result = await service.streamBundle('1.0.0', 'windows');

      expect(result).toBeDefined();
      expect(result.getHeaders().disposition).toContain('datamigrator-worker-windows-1.0.0.zip');
    });

    it('should reject path traversal in version parameter', async () => {
      await expect(
        service.streamBundle('../../../etc/passwd', 'linux'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // validateBundlesExist (precheck)
  // ===========================================================================

  describe('validateBundlesExist', () => {
    it('should pass when linux bundle exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readdirSync.mockReturnValue([
        'datamigrator-worker-linux-1.0.0.tar.gz' as any,
      ]);
      mockedFs.statSync.mockReturnValue({ size: 100 } as any);

      const result = (service as any).validateBundlesExist('1.0.0');

      expect(result.linux.available).toBe(true);
    });

    it('should pass when windows bundle exists', () => {
      mockedFs.existsSync.mockImplementation((p: any) => {
        return String(p).includes('windows');
      });
      mockedFs.readdirSync.mockImplementation((p: any) => {
        if (String(p).includes('windows')) {
          return ['datamigrator-worker-windows-1.0.0.zip' as any];
        }
        return [];
      });
      mockedFs.statSync.mockReturnValue({ size: 100 } as any);

      const result = (service as any).validateBundlesExist('1.0.0');

      expect(result.windows.available).toBe(true);
    });

    it('should throw when no bundles exist for either platform', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(() => (service as any).validateBundlesExist('1.0.0')).toThrow(BadRequestException);
    });
  });
});
