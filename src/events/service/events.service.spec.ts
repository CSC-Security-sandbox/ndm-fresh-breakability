import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { SocketEvents } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { WorkerRequestDTO } from '../dto/responsefilter.dto';
import { ValidateConnectionDto } from '../dto/validateconnection.dto';
import { FileConfigService } from './config.service';
import { EventsService } from './events.service';
import { RabbitMqService } from './rabbitmq.service';
import { FetchMountMsg } from '../controller/rabbitmq.types';

class MockRepositor<T> extends Repository<T> {
  async save(e: any):Promise<any> {
      return e
  }
  async findOne(e: any):Promise<any> {
      return e
  }
}

describe('EventsService', () => {
  let service: EventsService;
  let repository: MockRepositor<RequestTrackEntity>;
  let rabbitMqService: RabbitMqService;
  let fileConfigService: FileConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(RequestTrackEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: RabbitMqService,
          useValue: {
            publishToExchange: jest.fn(),
          },
        },
        {
          provide: FileConfigService,
          useValue: {
            updatePathToConfig: jest.fn(),
            getPathConfig: jest.fn(),
            updateRefetchingConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    repository = module.get<MockRepositor<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity));
    rabbitMqService = module.get<RabbitMqService>(RabbitMqService);
    fileConfigService = module.get<FileConfigService>(FileConfigService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});  
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('notifyEventToWorker', () => {
    it('should publish an event to RabbitMQ and log the action', async () => {
      const workerId = 'worker-123';
      const socketEvent = SocketEvents.VALIDATE_CONNECTION;
      const payload = { some: 'data' };

      await service.notifyEventToWorker(workerId, socketEvent, payload);

      expect(rabbitMqService.publishToExchange).toHaveBeenCalledWith({
        workerId,
        action: {
          eventType: socketEvent,
          message: payload,
        },
      });
    });
  });

  describe('validateWorkerConnection', () => {
    it('should save request tracks and notify workers', async () => {
      const details: ValidateConnectionDto = {
        hostname: 'host1',
        workers: ['worker1', 'worker2'],
        protocols: [
          { protocol: Protocol.NFS, username: 'user1', password: 'pass1' },
          { protocol: Protocol.SMB, username: 'user2', password: 'pass2' },
        ],
      };

      const createSpy = jest.spyOn(repository, 'create').mockImplementation((entity) => entity as any);
      const saveSpy = jest.spyOn(repository, 'save').mockResolvedValue(undefined);
      const notifySpy = jest.spyOn(service, 'notifyEventToWorker').mockResolvedValue(undefined);

      const result = await service.validateWorkerConnection(details);

      expect(createSpy).toHaveBeenCalledTimes(4);
      expect(saveSpy).toHaveBeenCalledTimes(4);
      expect(notifySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAllResponse', () => {
    it('should return paginated results if page and limit are provided', async () => {
      const responsePageFilterDto: WorkerRequestDTO = {
        page: '1',
        limit: '10',
        sort: 'createdAt',
        order: 'asc',
      };

      jest.spyOn(repository, 'find').mockResolvedValue([{ id: '1' } as any]);
      jest.spyOn(repository, 'count').mockResolvedValue(1);

      const result = await service.processWorkerResponses(responsePageFilterDto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should return all results if page and limit are not provided', async () => {
      const responsePageFilterDto: WorkerRequestDTO = {};

      jest.spyOn(repository, 'find').mockResolvedValue([{ id: '1' } as any]);
      jest.spyOn(repository, 'count').mockResolvedValue(1);

      const result = await service.processWorkerResponses(responsePageFilterDto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('fetchPathsByCred', () => {
    it('should map credentials to workers correctly and notify workers', async () => {
      const details: FetchMountMsg = {
        credentials: [
          {
            protocol: Protocol.NFS,
            details: {
              hostname: 'hostname1',
              username: 'user1',
              password: 'pass1',
            },
            workers: ['worker1', 'worker2'],
          },
        ],
        configId: 'config1',
      };

      await service.fetchPathsByCred(details);
    });

  });

  describe('fetchPaths', () => {
    it('should throw error if config does not exist', async () => {
      const configId = 'non-existent-config';
      fileConfigService.getPathConfig = jest.fn().mockResolvedValue(null); // Simulating no config found

      await expect(service.fetchPaths(configId)).rejects.toThrowError(
        new NotFoundException(`Config with ${configId} configId does not exists.`),
      );
    });

    it('should process and notify workers when config exists', async () => {
      const configId = 'config1';
      const config = {
        fileServers: [
          {
            protocol: 'NFS',
            host: 'host1',
            userName: 'user1',
            password: 'password1',
            workers: [{ workerId: 'worker1' }],
          },
        ],
      };
      fileConfigService.getPathConfig = jest.fn().mockResolvedValue(config);

      const map = new Map();
      map.set('worker1', [
        {
          protocol: 'NFS',
          details: {
            hostname: 'host1',
            username: 'user1',
            password: 'password1',
          },
        },
      ]);
      await service.fetchPaths(configId);
    });
  });
});
