import { Test, TestingModule } from '@nestjs/testing';
import { HealthcheckService } from './healthcheck.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { throwError } from 'rxjs';
import { AuthService } from 'src/auth/auth.service';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../auth/auth.service.spec';

let cronJobStore: CronJob | undefined;

const mockedSchedulerRegistry = {
  addCronJob: jest.fn((name: string, job: CronJob) => {
    cronJobStore = job;
  }),
};

const triggerCronJob = async (): Promise<void> => {
  if (cronJobStore && typeof cronJobStore.fireOnTick === 'function') {
    await cronJobStore.fireOnTick();
  }
};

describe('HealthcheckService', () => {
  let service: HealthcheckService;
  let httpService: HttpService;
  let configService: ConfigService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;
  let schedulerRegistry: SchedulerRegistry;
  const workerId = 'test-worker';
  const healthCheckInterval = 5;
  const mockedHttpService = { post: jest.fn() };
  const mockedConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'worker.healthCheckInterval') return healthCheckInterval;
      if (key === 'worker.workerId') return workerId;
      if (key === 'worker.connection.workerJobServiceUrl') return 'https://localhost:4000';
      return null;
    }),
  };
  const mockedLogger = mockLoggerFactory.create(HealthcheckService.name);
  const mockedTotalMem = jest.fn((): number => 8 * 1024 * 1024 * 1024);
  const mockedFreeMem = jest.fn((): number => 4 * 1024 * 1024 * 1024);
  const mockedCpu = { usage: jest.fn(() => Promise.resolve(50)) };
  const mockedDrive = {
    info: jest.fn(() => Promise.resolve({ totalGb: '500', freeGb: '300' })),
  };
  const mockedAuthService = {
    getAccessToken: jest.fn().mockResolvedValue('mocked-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthcheckService,
        { provide: HttpService, useValue: mockedHttpService },
        { provide: ConfigService, useValue: mockedConfigService },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        { provide: 'totalmem', useValue: mockedTotalMem },
        { provide: 'freemem', useValue: mockedFreeMem },
        { provide: 'cpu', useValue: mockedCpu },
        { provide: 'drive', useValue: mockedDrive },
        { provide: SchedulerRegistry, useValue: mockedSchedulerRegistry },
        { provide: AuthService, useValue: mockedAuthService },
      ],
    }).compile();
    service = module.get<HealthcheckService>(HealthcheckService);
    httpService = module.get<HttpService>(HttpService);
    configService = module.get<ConfigService>(ConfigService);
    loggerFactory = module.get<LoggerFactory>(LoggerFactory);
    logger = loggerFactory.create(HealthcheckService.name);
    schedulerRegistry = module.get<SchedulerRegistry>(SchedulerRegistry);
    jest.clearAllMocks();
    cronJobStore = undefined;
  });

  afterEach(() => {
    if (cronJobStore) {
      cronJobStore.stop();
      cronJobStore = undefined;
    }
  });

  describe('onModuleInit (Cron Registration)', () => {
    it('should register a cron job with correct expression', async () => {
      await service.onModuleInit();
      const expectedCronExpr = `*/${healthCheckInterval} * * * * *`;
      expect(mockedSchedulerRegistry.addCronJob).toHaveBeenCalled();
      const callArgs = mockedSchedulerRegistry.addCronJob.mock.calls[0];
      expect(callArgs[0]).toBe('healthcheck');
      expect(cronJobStore?.cronTime?.source).toBe(expectedCronExpr);
    });
  });

  describe('getSystemStats - positive path', () => {
    it('should return proper system stats as strings', async () => {
      const stats = await service.getSystemStats();
      expect(stats).toEqual({
        cpuUsage: '50.00%',
        memoryUsage: '50.00%',
        memoryLimit: '8.00GB',
        diskUsage: '40.00%',
        diskLimit: '500.00GB',
      });
    });
  });

  describe('getSystemStats - negative cases', () => {
    it('should return "-1" for disk stats when drive.info fails', async () => {
      mockedDrive.info.mockRejectedValueOnce(new Error('Disk error'));
      mockedCpu.usage.mockResolvedValue(25);
      const stats = await service.getSystemStats();
      expect(stats).toEqual({
        cpuUsage: '25.00%',
        memoryUsage: '50.00%',
        memoryLimit: '8.00GB',
        diskUsage: '-1',
        diskLimit: '-1',
      });
    });

    it('should return "-1" for memory stats when totalmem/freemem throw an error', async () => {
      const brokenTotalMem = jest.fn(() => {
        throw new Error('Memory error');
      });
      const brokenFreeMem = jest.fn(() => {
        throw new Error('Memory error');
      });
      const customDrive = {
        info: jest.fn(() => Promise.resolve({ totalGb: '256', freeGb: '200' })),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          HealthcheckService,
          { provide: HttpService, useValue: mockedHttpService },
          { provide: ConfigService, useValue: mockedConfigService },
          {
            provide: LoggerFactory,
            useValue: mockLoggerFactory,
          },
          { provide: 'totalmem', useValue: brokenTotalMem },
          { provide: 'freemem', useValue: brokenFreeMem },
          { provide: 'cpu', useValue: mockedCpu },
          { provide: 'drive', useValue: customDrive },
          { provide: SchedulerRegistry, useValue: mockedSchedulerRegistry },
          { provide: AuthService, useValue: mockedAuthService },
        ],
      }).compile();
      const newService = module.get<HealthcheckService>(HealthcheckService);
      await new Promise((resolve) => setTimeout(resolve, 10));
      mockedCpu.usage.mockResolvedValue(10);
      const stats = await newService.getSystemStats();
      expect(stats).toEqual({
        cpuUsage: '10.00%',
        memoryUsage: '-1',
        memoryLimit: '-1',
        diskUsage: '21.88%',
        diskLimit: '256.00GB',
      });
    });
  });

  describe('getHealthcheckPayload', () => {
    it('should return a valid payload with "HEALTHY" status', async () => {
      const fakeSystemStats = {
        cpuUsage: '30.00%',
        memoryUsage: '20.00%',
        memoryLimit: '4.00GB',
        diskUsage: '10.00%',
        diskLimit: '20.00GB',
      };
      jest.spyOn(service, 'getSystemStats').mockResolvedValue(fakeSystemStats);
      const payload = await service.getHealthcheckPayload();
      expect(payload).toEqual({
        workerId,
        healthStatus: 'HEALTHY',
        systemStats: fakeSystemStats,
      });
    });
  });

  describe('Cron Job Chain (Full Functionality)', () => {
    it('should successfully post healthcheck results when cron job is triggered', async () => {
      const payloadData = {
        workerId,
        healthStatus: 'HEALTHY',
        systemStats: {
          cpuUsage: '30.00%',
          memoryUsage: '20.00%',
          memoryLimit: '4.00GB',
          diskUsage: '10.00%',
          diskLimit: '20.00GB',
        },
      };
      jest
        .spyOn(service, 'getHealthcheckPayload')
        .mockResolvedValue(payloadData);
      await service.onModuleInit();
      await triggerCronJob();
      expect(mockedAuthService.getAccessToken).toHaveBeenCalled();
      await new Promise((resolve) => process.nextTick(resolve));
      expect(mockedHttpService.post).toHaveBeenCalledWith(
        'https://localhost:4000/api/v1/statscheck',
        payloadData,
        { headers: { Authorization: 'Bearer mocked-token' } },
      );
    });

    it('should log error when httpService.post fails via cron job chain', async () => {
      const error = new Error('HTTP error');
      jest.spyOn(service, 'getHealthcheckPayload').mockResolvedValue({
        workerId,
        healthStatus: 'HEALTHY',
        systemStats: {
          cpuUsage: '0.00%',
          memoryUsage: '0.00%',
          memoryLimit: '0.00%',
          diskUsage: '0.00%',
          diskLimit: '0.00%',
        },
      });
      mockedHttpService.post.mockReturnValue(throwError(() => error));
      await service.onModuleInit();
      await triggerCronJob();
      await new Promise((resolve) => process.nextTick(resolve));
      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Error in making statscheck API call: HTTP error',
      );
    });

    it('should log error if getAccessToken returns null in getPayloadAndToken', async () => {
      jest.spyOn(service, 'getHealthcheckPayload').mockResolvedValue({
      workerId,
      healthStatus: 'HEALTHY',
      systemStats: {
        cpuUsage: '0.00%',
        memoryUsage: '0.00%',
        memoryLimit: '0.00%',
        diskUsage: '0.00%',
        diskLimit: '0.00%',
      },
      });
      mockedAuthService.getAccessToken.mockResolvedValueOnce(null);
      await expect(service.getPayloadAndToken()).rejects.toThrow('Failed to get access token');
      expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error in getPayloadAndToken: Failed to get access token')
      );
    });

    it('should log error if getHealthcheckPayload throws in getPayloadAndToken', async () => {
      jest.spyOn(service, 'getHealthcheckPayload').mockRejectedValue(new Error('Payload error'));
      await expect(service.getPayloadAndToken()).rejects.toThrow('Payload error');
      expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error in getPayloadAndToken: Payload error')
      );
    });

    it('should handle error in postHealthcheckResults and log it', async () => {
      const payload = {
      workerId,
      healthStatus: 'HEALTHY',
      systemStats: {
        cpuUsage: '0.00%',
        memoryUsage: '0.00%',
        memoryLimit: '0.00%',
        diskUsage: '0.00%',
        diskLimit: '0.00%',
      },
      };
      const error = new Error('post error');
      mockedHttpService.post.mockReturnValueOnce(throwError(() => error));
      // @ts-ignore: access private method for test
      await service['postHealthcheckResults'](payload, 'token');
      await new Promise((resolve) => process.nextTick(resolve));
      expect(mockedLogger.error).toHaveBeenCalledWith(
      'Error in making statscheck API call: post error'
      );
    });

    it('should return -1 for cpu usage if cpu.usage throws', async () => {
      mockedCpu.usage.mockRejectedValueOnce(new Error('CPU error'));
      const stats = await service.getSystemStats();
      expect(stats.cpuUsage).toBe('-1');
    });
  });
});
