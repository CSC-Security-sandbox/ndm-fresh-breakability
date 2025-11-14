import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerController } from './work-manager.controller';
import { WorkManagerService } from './work-manager.service';
import { WorkerConfiguration } from 'src/constants/types';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { Platform } from 'src/constants/enums';

describe('WorkManagerController', () => {
  let controller: WorkManagerController;
  let serviceMock: WorkManagerService;

  beforeEach(async () => {
    serviceMock = {
      getConfiguration: jest.fn(),
      validateConnection: jest.fn(),
    } as unknown as WorkManagerService;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkManagerController],
      providers: [
        { provide: WorkManagerService, useValue: serviceMock },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();

    controller = module.get<WorkManagerController>(WorkManagerController);
  });

  describe('getConfiguration', () => {
    it('should return worker configuration when found', async () => {
      const workerId = '123123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';
      const mockConfig: WorkerConfiguration[] = [
        {
          configName: 'TestConfig',
          dynamicTaskQueue: false,
          taskQueueId: null,
          workerId: workerId,
        },
      ];

      jest.spyOn(serviceMock, 'getConfiguration').mockResolvedValue(mockConfig);

      const reqMock = {
        project_id: projectId,
        worker_id: '123123',
        headers: {
          'x-client-platform': Platform.WINDOWS,
        },
      };

      const bodyMock = {
        envVariables: { TEST_VAR: 'test_value' },
        isRebootCall: false,
      };

      const result = await controller.getConfiguration(ip, reqMock, bodyMock);

      expect(result).toEqual(mockConfig);
      expect(serviceMock.getConfiguration).toHaveBeenCalledWith(
        workerId,
        ip,
        projectId,
        Platform.WINDOWS,
        { TEST_VAR: 'test_value' },
        false,
      );
    });
  });

  describe('getWorkerConfigurations', () => {
    it('should return worker configurations', async () => {
      const workerId = '123123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';
      const mockConfig: WorkerConfiguration[] = [
        {
          configName: 'TestConfig',
          dynamicTaskQueue: false,
          taskQueueId: null,
          workerId: workerId,
        }
      ];

      jest.spyOn(serviceMock, 'getConfiguration').mockResolvedValue(mockConfig);

      const reqMock = {
        project_id: projectId,
        worker_id: '123123',
        headers: {
          'x-client-platform': Platform.LINUX,
        },
      };

      const result = await controller.getWorkerConfigurations(ip, reqMock);
      
      expect(result).toEqual(mockConfig);
      expect(serviceMock.getConfiguration).toHaveBeenCalledWith(
        workerId,
        ip,
        projectId,
        Platform.LINUX,
        {},     
        false,
      );
    });
  });

  describe('create', () => {
    it('should call validateConnection with the correct parameters', async () => {
      const payload: CreateRequestDto = {
        options: {
          startDelay: '10',
          workflowExecutionTimeout: '12',
          workflowRunTimeout: '12',
          workflowTaskTimeout: '12',
        },
        fileServer: { hostname: 'test', protocols: [] },
        workerIds: ['123'],
      };

      const reqMock = {
        trackId: 'trackId123',
      };

      jest
        .spyOn(serviceMock, 'validateConnection')
        .mockResolvedValue({ success: true } as any);

      const result = await controller.create(payload, reqMock);

      expect(result).toEqual({ success: true });
      expect(serviceMock.validateConnection).toHaveBeenCalledWith(
        payload,
        reqMock.trackId,
      );
    });
  });
});
