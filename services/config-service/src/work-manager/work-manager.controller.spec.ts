import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerController } from './work-manager.controller';
import { WorkManagerService } from './work-manager.service';
import { WorkerConfiguration } from 'src/constants/types';
import { CreateRequestDto } from './dto/validate-connection.dto';
import { ConfigStatusPayloadDTO } from './dto/validate-export-path.dto';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { Platform, ConfigStatus } from 'src/constants/enums';

describe('WorkManagerController', () => {
  let controller: WorkManagerController;
  let serviceMock: WorkManagerService;

  beforeEach(async () => {
    serviceMock = {
      getConfiguration: jest.fn(),
      validateConnection: jest.fn(),
      validateWorkingDirectory: jest.fn(),
      getChildWorkFlowRes: jest.fn(),
      updateWorkerConfigurations: jest.fn(),
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
      const mockConfig = {
        metaConfig: [
          {
            configName: 'TestConfig',
            dynamicTaskQueue: false,
            taskQueueId: null,
            workerId: workerId,
          },
        ] as WorkerConfiguration[],
        envVariables: { TEST_VAR: 'test_value' },
      };

      jest.spyOn(serviceMock, 'getConfiguration').mockResolvedValue(mockConfig);

      const reqMock = {
        project_id: projectId,
        worker_id: '123123',
        headers: {
          'x-client-platform': Platform.WINDOWS,
          'x-worker-ip': ip,
        },
      };

      const bodyMock = {
        envVariables: { TEST_VAR: 'test_value' },
        isRebootCall: false,
        workerVersion: '2026.02.01',
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
        '2026.02.01',
      );
    });

    it('should pass undefined workerVersion when not provided in body', async () => {
      const mockConfig = {
        metaConfig: [] as WorkerConfiguration[],
        envVariables: {},
      };

      jest.spyOn(serviceMock, 'getConfiguration').mockResolvedValue(mockConfig);

      const reqMock = {
        project_id: 'proj-1',
        worker_id: 'w-1',
        headers: {
          'x-client-platform': Platform.LINUX,
          'x-worker-ip': '10.0.0.1',
        },
      };

      await controller.getConfiguration('10.0.0.1', reqMock, {});

      expect(serviceMock.getConfiguration).toHaveBeenCalledWith(
        'w-1',
        '10.0.0.1',
        'proj-1',
        Platform.LINUX,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('getWorkerConfigurations', () => {
    it('should return worker configurations', async () => {
      const workerId = '123123';
      const ip = '127.0.0.1';
      const projectId = 'projectId';
      const mockConfig = {
        metaConfig: [
          {
            configName: 'TestConfig',
            dynamicTaskQueue: false,
            taskQueueId: null,
            workerId: workerId,
          },
        ] as WorkerConfiguration[],
        envVariables: {},
      };

      jest.spyOn(serviceMock, 'getConfiguration').mockResolvedValue(mockConfig);

      const reqMock = {
        project_id: projectId,
        worker_id: '123123',
        headers: {
          'x-client-platform': Platform.LINUX,
          'x-worker-ip': ip,
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
        null,
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

  describe('validateWorkingDirectory', () => {
    it('should call validateWorkingDirectory with the payload', async () => {
      const payload: ConfigStatusPayloadDTO = {
        configId: 'config-123',
        status: ConfigStatus.ACTIVE,
        errorMessage: null,
      };

      jest
        .spyOn(serviceMock, 'validateWorkingDirectory')
        .mockResolvedValue({ valid: true } as any);

      const result = await controller.validateWorkingDirectory(payload);

      expect(result).toEqual({ valid: true });
      expect(serviceMock.validateWorkingDirectory).toHaveBeenCalledWith(payload);
    });

    it('should pass error message when validation fails', async () => {
      const payload: ConfigStatusPayloadDTO = {
        configId: 'config-123',
        status: ConfigStatus.ERRORED,
        errorMessage: 'Path not accessible',
      };

      jest
        .spyOn(serviceMock, 'validateWorkingDirectory')
        .mockResolvedValue({ valid: false, error: 'Path not accessible' } as any);

      const result = await controller.validateWorkingDirectory(payload);

      expect(result).toEqual({ valid: false, error: 'Path not accessible' });
      expect(serviceMock.validateWorkingDirectory).toHaveBeenCalledWith(payload);
    });
  });

  describe('getChildWorkFlowRes', () => {
    it('should return workflow result for given id', async () => {
      const workflowId = 'workflow-abc-123';
      const expected = { status: 'COMPLETED', result: { data: 'test' } };

      jest
        .spyOn(serviceMock, 'getChildWorkFlowRes')
        .mockResolvedValue(expected as any);

      const result = await controller.getChildWorkFlowRes(workflowId);

      expect(result).toEqual(expected);
      expect(serviceMock.getChildWorkFlowRes).toHaveBeenCalledWith(workflowId);
    });
  });

  describe('updateWorkerConfigurations', () => {
    it('should call updateWorkerConfigurations with jobRunId and workerId', () => {
      const jobRunId = 'job-run-123';
      const workerId = 'worker-456';
      const expected = { updated: true };

      jest
        .spyOn(serviceMock, 'updateWorkerConfigurations')
        .mockReturnValue(expected as any);

      const result = controller.updateWorkerConfigurations(jobRunId, workerId);

      expect(result).toEqual(expected);
      expect(serviceMock.updateWorkerConfigurations).toHaveBeenCalledWith(
        jobRunId,
        workerId,
      );
    });
  });
});
