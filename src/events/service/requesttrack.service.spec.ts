import { Test, TestingModule } from '@nestjs/testing';
import { RequestTrackService } from './requesttrack.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { FileConfigService } from './config.service';
import { ValidateConnectionRes, ListPathRes } from '../events.type';
import { Operations, ResponseStatus, TaskType } from 'src/constants/status';

describe('RequestTrackService', () => {
  let service: RequestTrackService;
  let reqTrackRepo: jest.Mocked<Repository<RequestTrackEntity>>;
  let configService: jest.Mocked<FileConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestTrackService,
        {
          provide: getRepositoryToken(RequestTrackEntity),
          useValue: {
            update: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: FileConfigService,
          useValue: {
            updatePathToConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RequestTrackService>(RequestTrackService);
    reqTrackRepo = module.get<Repository<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity)) as jest.Mocked<Repository<RequestTrackEntity>>;
    configService = module.get<FileConfigService>(FileConfigService) as jest.Mocked<FileConfigService>;
  });

  describe('validateConnectionAck', () => {
    it('should update the request track repository with operation responses', async () => {
      const ack: ValidateConnectionRes = {
        workerId: 'worker-1',
        taskType: TaskType.VALIDATE_CONNECTION,
        transactionId: 'txn-123',
        id: '345678',
        status: ResponseStatus.COMPLETED,
        operations: [
          {
            operation: Operations.VALIDATE_NFS_CONNECTION,
            response: {
            },
            status:  ResponseStatus.COMPLETED,
          },
          
        ],
      };

      await service.validateConnectionACk(ack);

      expect(reqTrackRepo.update).toHaveBeenCalledWith(
        { workerId: 'worker-1', taskType: 'VALIDATE_CONNECTION', operation: Operations.VALIDATE_NFS_CONNECTION, transactionId: 'txn-123' },
        {
          response: JSON.stringify({}),
          status: 'COMPLETED',
        },
      );
    });
  });

   describe('listPathAck', () => {
    it('should update the request track repository and call configService', async () => {
      const ack: ListPathRes = {
        workerId: 'worker-1',
        taskType: TaskType.LIST_PATHS,
        transactionId: 'txn-123',
        id: '345678',
        status: ResponseStatus.COMPLETED,
        operations: [
          {
            operation: Operations.LIST_NFS_PATHS,
            response: {
                paths: ['/path1', '/path2']
            },
            status:  ResponseStatus.COMPLETED,
          },
          
        ],
      };

      const request = { configId: 'config-123' } as RequestTrackEntity;

      reqTrackRepo.findOne.mockResolvedValue(request);

      await service.listPathAck(ack);

      expect(reqTrackRepo.update).toHaveBeenCalledWith(
        { workerId: 'worker-1', taskType: TaskType.LIST_PATHS, operation: Operations.LIST_NFS_PATHS, transactionId: 'txn-123' },
        {
          response: JSON.stringify({ paths: ['/path1', '/path2'] }),
          status: 'COMPLETED',
        },
      );

      expect(configService.updatePathToConfig).toHaveBeenCalledWith('config-123', ack);
    });

    it('should log an error if the request is not found', async () => {
      const ack: ListPathRes = {
        workerId: 'worker-1',
        taskType: TaskType.LIST_PATHS,
        transactionId: 'txn-123',
        id: '345678',
        status: ResponseStatus.COMPLETED,
        operations: [
          {
            operation: Operations.LIST_NFS_PATHS,
            response: {},
            status:  ResponseStatus.ERROR,
          },
          
        ],
      };

      reqTrackRepo.findOne.mockResolvedValue(null);

      await service.listPathAck(ack);

      expect(configService.updatePathToConfig).not.toHaveBeenCalled();
    });

  
  });
});
