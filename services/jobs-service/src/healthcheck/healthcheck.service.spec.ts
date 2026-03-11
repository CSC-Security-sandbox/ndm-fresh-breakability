import { Test, TestingModule } from '@nestjs/testing';
import { HealthcheckService } from './healthcheck.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';
import { HealthcheckStats } from './dto/healthcheck.dto';

describe('HealthcheckService', () => {
  let service: HealthcheckService;
  let workerRepository: Repository<WorkerEntity>;
  let workerStatsRepository: Repository<WorkerStatsEntity>;
  let mockLogger: LoggerService;

  beforeEach(async () => {
    // Create mock logger
    mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as any;

    // Create mock LoggerFactory
    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthcheckService,
        {
          provide: getRepositoryToken(WorkerStatsEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkerEntity),
          useClass: Repository,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<HealthcheckService>(HealthcheckService);
    workerRepository = module.get<Repository<WorkerEntity>>(
      getRepositoryToken(WorkerEntity),
    );
    workerStatsRepository = module.get<Repository<WorkerStatsEntity>>(
      getRepositoryToken(WorkerStatsEntity),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should update stats if worker and stats exist', async () => {
    const healthStats: HealthcheckStats = {
      workerId: 'worker-123',
      healthStatus: 'healthy',
      systemStats: {
        cpuUsage: '50',
        memoryUsage: '70',
        memoryLimit: 'm-limit',
        diskLimit: 'd-limit',
        diskUsage: 'd-usage',
      },
    };

    const worker = new WorkerEntity();
    worker.workerName = 'Worker 1';
    worker.workerId = 'worker-123';

    const statsEntity = new WorkerStatsEntity();
    statsEntity.healthStatus = 'unhealthy';
    statsEntity.systemStats = {
      cpuUsage: 'c-usage',
      memoryUsage: 'm-usage',
      memoryLimit: 'm-limit',
      diskLimit: 'd-limit',
      diskUsage: 'd-usage',
    };
    worker.stats = statsEntity;

    jest.spyOn(workerRepository, 'findOne').mockResolvedValue(worker);
    jest.spyOn(workerStatsRepository, 'save').mockResolvedValue(statsEntity);

    await service.createOrUpdateHealthCheckStats(healthStats);

    expect(workerRepository.findOne).toHaveBeenCalledWith({
      where: { workerId: 'worker-123' },
      relations: ['stats'],
    });
    expect(workerStatsRepository.save).toHaveBeenCalledWith({
      ...statsEntity,
    });
  });

  it('should create stats if worker exists but stats do not', async () => {
    const healthStats: HealthcheckStats = {
      workerId: 'worker-123',
      healthStatus: 'healthy',
      systemStats: {
        cpuUsage: '50',
        memoryUsage: '70',
        memoryLimit: 'm-limit',
        diskLimit: 'd-limit',
        diskUsage: 'd-usage',
      },
    };

    const worker = new WorkerEntity();
    worker.workerName = 'Worker 1';
    worker.workerId = 'worker-123';
    worker.stats = null; // Simulate no existing stats

    const mockWorkerStatsEntity = new WorkerStatsEntity();
    mockWorkerStatsEntity.workerId = 'worker-123';
    mockWorkerStatsEntity.healthStatus = 'healthy';
    mockWorkerStatsEntity.systemStats = {
      cpuUsage: '50',
      memoryUsage: '70',
      memoryLimit: 'm-limit',
      diskLimit: 'd-limit',
      diskUsage: 'd-usage',
    };
    jest.spyOn(workerRepository, 'findOne').mockResolvedValue(worker);
    jest
      .spyOn(workerStatsRepository, 'create')
      .mockReturnValue(mockWorkerStatsEntity);
    jest.spyOn(workerStatsRepository, 'save').mockResolvedValue(null);

    await service.createOrUpdateHealthCheckStats(healthStats);

    expect(workerRepository.findOne).toHaveBeenCalledWith({
      where: { workerId: 'worker-123' },
      relations: ['stats'],
    });
    expect(workerStatsRepository.create).toHaveBeenCalled();
    expect(workerStatsRepository.save).toHaveBeenCalledWith({
      ...mockWorkerStatsEntity,
    });
  });

  it('should throw an error if worker does not exist', async () => {
    const healthStats: HealthcheckStats = {
      workerId: 'worker-123',
      healthStatus: 'healthy',
      systemStats: {
        cpuUsage: '50',
        memoryUsage: '70',
        memoryLimit: 'm-limit',
        diskLimit: 'd-limit',
        diskUsage: 'd-usage',
      },
    };

    jest.spyOn(workerRepository, 'findOne').mockResolvedValue(null);

    await expect(
      service.createOrUpdateHealthCheckStats(healthStats),
    ).rejects.toThrow('Worker with ID worker-123 does not exist');

    expect(workerRepository.findOne).toHaveBeenCalledWith({
      where: { workerId: 'worker-123' },
      relations: ['stats'],
    });
  });

  it('should log an error if an exception occurs', async () => {
    const healthStats: HealthcheckStats = {
      workerId: 'worker-123',
      healthStatus: 'healthy',
      systemStats: {
        cpuUsage: '50',
        memoryUsage: '70',
        memoryLimit: 'm-limit',
        diskLimit: 'd-limit',
        diskUsage: 'd-usage',
      },
    };

    jest
      .spyOn(workerRepository, 'findOne')
      .mockRejectedValue(new Error('Database error'));
    jest.spyOn(mockLogger, 'error');

    await expect(
      service.createOrUpdateHealthCheckStats(healthStats),
    ).rejects.toThrow('Database error');
  });
});
