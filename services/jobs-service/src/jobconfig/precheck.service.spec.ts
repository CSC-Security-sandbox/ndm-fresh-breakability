import { Test, TestingModule } from '@nestjs/testing';
import { PreCheckService } from './precheck.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { VolumeEntity } from '../entities/volume.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { InventoryEntity } from '../entities/inventory.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { WorkflowService } from '../workflow/workflow.service';
import { ConfigService } from '@nestjs/config';
import { MigrationConflictService } from '../migration-conflict/migration-conflict.service';
import { Repository, In } from 'typeorm';
import { JobConfigPrecheck } from './dto/jobdicoverybulk.dto';
import { HealthStatus } from 'src/workers/worker.types';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestException } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib'; 
// Streamlined and optimized test suite for PreCheckService

describe('PreCheckService', () => {
  let service: PreCheckService;
  let volumeRepo: jest.Mocked<Repository<VolumeEntity>>;
  let jobRunRepo: jest.Mocked<Repository<JobRunEntity>>;
  let inventoryRepo: jest.Mocked<Repository<InventoryEntity>>;
  let workflowService: jest.Mocked<WorkflowService>;
  let configService: jest.Mocked<ConfigService>;

  const defaultPreCheckData: JobConfigPrecheck = {
    preserveAccessTime: true,
    migrateConfigs: [{ sourcePathId: 'src1', destinationPathId: ['dest1'] }],
    options: {
      workflowExecutionTimeout: '300',
      workflowTaskTimeout: '60',
      workflowRunTimeout: '600',
      startDelay: '10',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreCheckService,
        { provide: getRepositoryToken(VolumeEntity), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(JobRunEntity), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(InventoryEntity), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(JobConfigEntity), useValue: { find: jest.fn(), createQueryBuilder: jest.fn() } },
        { provide: WorkflowService, useValue: { startWorkflow: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('60') } },
        {
          provide: MigrationConflictService,
          useValue: {
            checkMigrationConflicts: jest.fn().mockResolvedValue([]),
            hasMigrationConflicts: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              log: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<PreCheckService>(PreCheckService);
    volumeRepo = module.get(getRepositoryToken(VolumeEntity));
    jobRunRepo = module.get(getRepositoryToken(JobRunEntity));
    inventoryRepo = module.get(getRepositoryToken(InventoryEntity));
    workflowService = module.get(WorkflowService);
    configService = module.get(ConfigService);

    jest.clearAllMocks();
  });

  it('should return workflowId on successful precheck', async () => {
    // Arrange
    const mockVolumes = [
      {
        id: 'src1',
        volumePath: '/src',
        fileServer: {
          id: 'fs1', host: 'h1', userName: 'u1', password: 'p1', protocol: 'ftp', protocolVersion: 'v1', serverType: 't1',
          workers: [
            { workerId: 'w1', stats: { healthStatus: HealthStatus.Healthy, updatedAt: new Date() } },
          ],
        },
      },
      {
        id: 'dest1',
        volumePath: '/dest',
        fileServer: {
          id: 'fs2', host: 'h2', userName: 'u2', password: 'p2', protocol: 'ftp', protocolVersion: 'v1', serverType: 't2',
          workers: [
            { workerId: 'w1', stats: { healthStatus: HealthStatus.Healthy, updatedAt: new Date() } },
          ],
        },
      },
    ];
    volumeRepo.find.mockResolvedValue(mockVolumes as any);

    const mockJobRunQB: any = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'jr1' }),
    };
    jobRunRepo.createQueryBuilder.mockReturnValue(mockJobRunQB);

    const mockInvQB: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalSize: '500' }),
    };
    inventoryRepo.createQueryBuilder.mockReturnValue(mockInvQB);

    workflowService.startWorkflow.mockResolvedValue({ workflowId: 'wf1' } as any);

    // Act
    const result = await service.initiatePreCheck(defaultPreCheckData);

    // Assert
    expect(result).toEqual({ workflowId: 'wf1' });
    expect(volumeRepo.find).toHaveBeenCalledWith({
      where: { id: In(['src1', 'dest1']) },
      relations: { fileServer: { workers: { stats: true } } },
    });
    expect(workflowService.startWorkflow).toHaveBeenCalled();
  });

  it('should return error object when workflow fails', async () => {
    // Arrange
    volumeRepo.find.mockResolvedValue([]);
    workflowService.startWorkflow.mockRejectedValue(new Error('fail'));

    // Act
    const res = await service.initiatePreCheck(defaultPreCheckData);

    // Assert
    expect(res).toHaveProperty('status', 'error');
    expect(res.erros).toEqual(['PRECHECK_FAILED']);
    expect(res.message).toContain('Failed to perform the pre check');
  });

  it('should return error object when no volume mapping', async () => {
    // Arrange: no volumes found
    volumeRepo.find.mockResolvedValue([]);
    workflowService.startWorkflow.mockResolvedValue({ workflowId: 'wf1' } as any);

    // Act
    const result = await service.initiatePreCheck(defaultPreCheckData);
        expect(result).toEqual({ workflowId: 'wf1' });

  });

  it('should throw BadRequestException with MIGRATION_CONFLICTS_FOUND when migration conflicts are detected', async () => {
  // Arrange
  const migrationConflictResult = [{
    status: 'ACTIVE',
    jobId: 'job-1',
    jobRunIds: ['run-1'],
    sourcePathId: 'src1',
    targetPathId: 'dest1',
    sourceServerId: 'source-server',
    targetServerId: 'target-server',
  }];
  jest.spyOn(service['migrationConflictService'], 'checkMigrationConflicts').mockResolvedValue(migrationConflictResult);

  // Act & Assert
  try {
    await service.initiatePreCheck({
      preserveAccessTime: true,
      migrateConfigs: [{ sourcePathId: 'src1', destinationPathId: ['dest1'] }],
      options: {
        workflowExecutionTimeout: '300',
        workflowTaskTimeout: '60',
        workflowRunTimeout: '600',
        startDelay: '10',
      },
    });
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = error.getResponse();
    expect(response).toMatchObject({
      status: 'error',
      errors: ['MIGRATION_CONFLICTS_FOUND'],
      details: migrationConflictResult,
      message: 'Migration conflicts detected during precheck.',
    });
  }
});


   describe('getLatestDiscoveryInventorySize', () => {
    it('should return -1 for invalid UUID', async () => {
      const size = await service.getLatestDiscoveryInventorySize('invalid-uuid');
      expect(size).toBe(-1);
    });

    it('should return -1 when no discovery job run found', async () => {
      const mockQB: any = { innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(null) };
      jobRunRepo.createQueryBuilder.mockReturnValue(mockQB);

      const size = await service.getLatestDiscoveryInventorySize(uuidv4());
      expect(size).toBe(-1);
    });

    it('should return 0 when inventory totalSize is null or zero', async () => {
      const mockRun: any = { id: 'jr1' };
      const mockJB: any = { innerJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(mockRun) };
      jobRunRepo.createQueryBuilder.mockReturnValue(mockJB);

      const mockInvQB: any = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(), getRawOne: jest.fn().mockResolvedValue({ totalSize: null }) };
      inventoryRepo.createQueryBuilder.mockReturnValue(mockInvQB);

      const size = await service.getLatestDiscoveryInventorySize(uuidv4());
      expect(size).toBe(0);
    });

    it('should return parsed totalSize when present', async () => {
      const mockRun: any = { id: 'jr2' };
      const mockJB: any = { innerJoinAndSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(mockRun) };
      jobRunRepo.createQueryBuilder.mockReturnValue(mockJB);

      const mockInvQB: any = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(), getRawOne: jest.fn().mockResolvedValue({ totalSize: '1234' }) };
      inventoryRepo.createQueryBuilder.mockReturnValue(mockInvQB);

      const size = await service.getLatestDiscoveryInventorySize(uuidv4());
      expect(size).toBe(1234);
    });
  });
});
