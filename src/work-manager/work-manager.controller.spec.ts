import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerController } from './work-manager.controller';
import { WorkManagerService } from './work-manager.service';
import { WorkerConfiguration } from 'src/constants/types';
import { CreateRequestDto } from './dto/validate-connection.dto';

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
      providers: [{ provide: WorkManagerService, useValue: serviceMock }],
    }).compile();

    controller = module.get<WorkManagerController>(WorkManagerController);
  });

  describe('getConfiguration', () => {
    it('should return worker configuration when found', async () => {
      const workerId = '123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';
      const workerName = 'workerName';
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
        headers: {
          'project-id': projectId,
          'worker-name': workerName,
        },
      };

      const result = await controller.getConfiguration(workerId, ip, reqMock);

      expect(result).toEqual(mockConfig);
      expect(serviceMock.getConfiguration).toHaveBeenCalledWith(workerId, ip, projectId, workerName);
    });
  });

  describe('create', () => {
    it('should call validateConnection with the correct parameters', async () => {
      const payload: CreateRequestDto = {
        options: { startDelay: '10', workflowExecutionTimeout: '12',workflowRunTimeout :'12' , workflowTaskTimeout: '12' },
        fileServer: { hostname: 'test', protocols: [] },
        workerIds: ['123']
      };

      const reqMock = {
        trackId: 'trackId123',
      };

      jest.spyOn(serviceMock, 'validateConnection').mockResolvedValue({ success: true } as any);

      const result = await controller.create(payload, reqMock);

      expect(result).toEqual({ success: true });
      expect(serviceMock.validateConnection).toHaveBeenCalledWith(payload, reqMock.trackId);
    });
  });
});
