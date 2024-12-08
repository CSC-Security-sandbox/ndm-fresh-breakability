import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { FileConfigService } from './config.service';
import { Repository } from 'typeorm';

import { Operations, ResponseStatus, TaskType } from 'src/constants/status';
import { Protocol } from 'src/constants/enums';
import { ListPathRes } from 'src/events/events.type';
// import { OperationToProtocol } from 'src/utils/mapper';

// jest.mock('src/utils/mapper', () => ({
 const OperationToProtocol= jest.fn()
// }));

describe('FileConfigService', () => {
  let service: FileConfigService;
  let configRepository: Repository<ConfigEntity>;
  let fileServerRepository: Repository<FileServerEntity>;
  let volumeRepository: Repository<VolumeEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileConfigService,
        {
          provide: getRepositoryToken(ConfigEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: {
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(VolumeEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FileConfigService>(FileConfigService);
    configRepository = module.get<Repository<ConfigEntity>>(getRepositoryToken(ConfigEntity));
    fileServerRepository = module.get<Repository<FileServerEntity>>(getRepositoryToken(FileServerEntity));
    volumeRepository = module.get<Repository<VolumeEntity>>(getRepositoryToken(VolumeEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('updatePathToConfig', () => {
    const configId = 'config-id';
    const ack: ListPathRes = {
      workerId: 'worker-1',
      taskType: TaskType.LIST_PATHS,
      id: '345678',
      status: ResponseStatus.COMPLETED,
      transactionId: '23456',
      operations: [
        {
          operation: Operations.LIST_NFS_PATHS,
          response: {
            paths: ['/path1', '/path2'],

          },
          status: ResponseStatus.COMPLETED
        },
      ],
    };

    it('should log an error if config does not exist', async () => {
      jest.spyOn(configRepository, 'findOne').mockResolvedValue(null);
      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await service.updatePathToConfig(configId, ack);

      expect(loggerSpy).toHaveBeenCalledWith(`Config Does't exist for id ${configId}`);
    });

    it('should log an error for operations with errors', async () => {
      const config = { fileServers: [] } as ConfigEntity;
      jest.spyOn(configRepository, 'findOne').mockResolvedValue(config);

      const loggerSpy = jest.spyOn(service['logger'], 'error');
      const ackWithError: ListPathRes = {
        ...ack,
        operations: [
          {
            operation: Operations.LIST_NFS_PATHS,
            status: ResponseStatus.ERROR,
            response: {
              paths: [],
              errors: [{
                errorCode:'234',
                errorMessage: 'Error occurred'
              }],
            },
          },
        ],
      };

      await service.updatePathToConfig(configId, ackWithError);

      expect(loggerSpy).toHaveBeenCalledWith(
        `Error on worker ${ackWithError.workerId} for ${ackWithError.operations[0].operation} `
      );
    });

    it('should update the path reach count for existing volumes', async () => {
      const volume : VolumeEntity= { 
        id: 'volume-1', volumePath: '/path1', reachableCount: 2, 
        createdAt: new Date(), createdBy: 'test', 
      } as VolumeEntity;
      const fileServer : FileServerEntity = {
        id: 'fileServer-1',
        protocol: Protocol.NFS,
        volumes: [volume],
        userName: 'asd',
        workers: [{ workerId: 'worker-1' } as  any],
      }  as FileServerEntity;
      const config = { id: configId, fileServers: [fileServer] } as ConfigEntity;

      jest.spyOn(configRepository, 'findOne').mockResolvedValue(config);
      OperationToProtocol.mockReturnValue(Protocol.NFS);
      

      await service.updatePathToConfig(configId, ack);

      expect(volumeRepository.update).toHaveBeenCalledWith(
        { id: volume.id },
        { reachableCount: volume.reachableCount + 1 }
      );
    });

    it('should add new volumes for paths not already present', async () => {
      const volume : VolumeEntity= { 
        id: 'volume-1', volumePath: '/path1', reachableCount: 2, 
        createdAt: new Date(), createdBy: 'test', 
      } as VolumeEntity;
      const fileServer : FileServerEntity = {
        id: 'fileServer-1',
        protocol: Protocol.NFS,
        volumes: [volume],
        userName: 'asd',
        workers: [{ workerId: 'worker-1' } as  any],
      }  as FileServerEntity;

      const config = { id: configId, fileServers: [fileServer] } as ConfigEntity;

      jest.spyOn(configRepository, 'findOne').mockResolvedValue(config);
      OperationToProtocol.mockReturnValue(Protocol.NFS);
      jest.spyOn(volumeRepository, 'create').mockReturnValue({} as VolumeEntity);

      await service.updatePathToConfig(configId, ack);

      expect(volumeRepository.create).toHaveBeenCalledWith({
        fileServerId: fileServer.id,
        volumePath: '/path2',
        createdBy: configId,
        reachableCount: 1,
      });
      expect(volumeRepository.save).toHaveBeenCalled();
    });
  });
});
