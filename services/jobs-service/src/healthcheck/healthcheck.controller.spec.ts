import { Test, TestingModule } from '@nestjs/testing';
import { HealthcheckController } from './healthcheck.controller';
import { HealthcheckService } from './healthcheck.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { cpuUsage } from 'process';
import { HealthcheckStats } from './dto/healthcheck.dto';
import { HealthCheckResponse } from './dto/healthcheck-response.dto';
import { HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

describe('HealthcheckController', () => {
  let controller: HealthcheckController;
  let service: HealthcheckService;
  let mockLogger: LoggerService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: [],
            projects: [],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

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
      controllers: [HealthcheckController],
      providers: [
        {
          provide: HealthcheckService,
          useValue: {
            createOrUpdateHealthCheckStats: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<HealthcheckController>(HealthcheckController);
    service = module.get<HealthcheckService>(HealthcheckService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return success response when service executes successfully', async () => {
    // Arrange
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
      .spyOn(service, 'createOrUpdateHealthCheckStats')
      .mockResolvedValueOnce();

    // Act
    const mockReq = { worker_id: 'mock-worker-id' };

    const response: HealthCheckResponse = await controller.healthCheck(
      healthStats,
      mockReq,
    );

    // Assert
    expect(service.createOrUpdateHealthCheckStats).toHaveBeenCalledWith(
      healthStats,
    );
    expect(mockLogger.log).toHaveBeenCalledWith(
      `Received health check stats from worker: mock-worker-id`,
    );
    expect(response).toEqual({
      statusCode: HttpStatus.OK,
    });
  });

  it('should return failure response and log error when service throws an error', async () => {
    // Arrange
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
    const error = new Error('Worker not found');
    jest
      .spyOn(service, 'createOrUpdateHealthCheckStats')
      .mockRejectedValueOnce(error);
    const mockReq = { worker_id: '"worker-123' };

    // Act
    await expect(controller.healthCheck(healthStats, mockReq)).rejects.toThrow(
      InternalServerErrorException,
    );

    // Assert
    expect(service.createOrUpdateHealthCheckStats).toHaveBeenCalledWith(
      healthStats,
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error creating or updating health check stats:',
      'Worker not found',
    );
  });
});
