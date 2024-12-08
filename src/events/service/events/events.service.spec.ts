import { Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { Operations, ResponseStatus, SocketEvents, TaskType } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { WorkerRequestDTO } from '../../dto/responsefilter.dto';
import { ValidateConnectionDto } from '../../dto/validateconnection.dto';

import { EventsService } from './events.service';
import { Credentials, ListPathsMsg } from '../../controller/rabbitmq.types';
import { RabbitMqService } from '../rabbitmq/rabbitmq.service';
import { FileConfigService } from '../config/config.service';

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
      const details: ListPathsMsg = {
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

  it('should handle fetchPathNotify correctly', async () => {
    const map = new Map<string, Omit<Credentials, 'workers'>[]>();
    const transactionId = 'test-transaction-id';
    const configId = 'test-config-id';

    const worker1 = 'worker-1';
    const credentials1= [
      { protocol: Protocol.NFS, details: {}, worker: [] },
      { protocol: Protocol.SMB, details: {}, worker: []  },
    ];

    map.set(worker1, credentials1);

    const baseListPathReqByDetailsSpy = jest
      .spyOn(service, 'baseListPathReqByDetails')
      .mockReturnValue({} as any) ;

    const notifyEventToWorkerSpy = jest
      .spyOn(service, 'notifyEventToWorker')
      .mockImplementation(async () => {}); 

    await service.fetchPathNotify(map, transactionId, configId);

    expect(baseListPathReqByDetailsSpy).toHaveBeenCalledWith(
      credentials1,
      transactionId,
      worker1,
    );

    expect(repository.create).toHaveBeenCalledTimes(2); 
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId,
        status: ResponseStatus.PENDING,
        taskType: TaskType.LIST_PATHS,
        workerId: worker1,
        operation: Operations.LIST_NFS_PATHS,
        configId,
      }),
    );

    expect(repository.save).toHaveBeenCalledTimes(2); 
  });

  it('should generate the correct ListPathReq payload', () => {
    const transactionId = 'test-transaction-id';
    const worker = 'worker-1';
    const credentials = [
      {
        protocol: Protocol.NFS,
        details: { hostname: 'host1', username: 'user1', password: 'pass1' },
      },
      {
        protocol: Protocol.SMB,
        details: { hostname: 'host2', username: 'user2', password: 'pass2' },
      },
    ];

    const expectedPayload = {
      id: transactionId,
      status: ResponseStatus.PENDING,
      taskType: TaskType.LIST_PATHS,
      transactionId,
      workerId: worker,
      operations: [
        {
          operation: Operations.LIST_NFS_PATHS,
          request: { hostname: 'host1', username: 'user1', password: 'pass1' },
          status: ResponseStatus.PENDING,
        },
        {
          operation: Operations.LIST_SMB_PATHS,
          request: { hostname: 'host2', username: 'user2', password: 'pass2' },
          status: ResponseStatus.PENDING,
        },
      ],
    };

    const result = service.baseListPathReqByDetails(credentials, transactionId, worker);

    expect(result).toEqual(expectedPayload);
  });

  it('should handle empty credentials array', () => {
    const transactionId = 'test-transaction-id';
    const worker = 'worker-1';
    const credentials = [];

    const expectedPayload = {
      id: transactionId,
      status: ResponseStatus.PENDING,
      taskType: TaskType.LIST_PATHS,
      transactionId,
      workerId: worker,
      operations: [],
    };

    const result = service.baseListPathReqByDetails(credentials, transactionId, worker);

    expect(result).toEqual(expectedPayload);
  });

  it('should handle empty protocols array', () => {
    const transactionId = 'test-transaction-id';
    const details = {
      hostname: 'host1',
      protocols: [],
    };

    const expectedPayload = {
      id: transactionId,
      status: ResponseStatus.PENDING,
      taskType: TaskType.VALIDATE_CONNECTION,
      transactionId,
      workerId: '',
      operations: [],
    };

    const result = service.baseValidateConnectionReq(details as any, transactionId);

    expect(result).toEqual(expectedPayload);
  });

  it('should handle single protocol correctly', () => {
    const transactionId = 'test-transaction-id';
    const details = {
      hostname: 'host1',
      protocols: [{ protocol: Protocol.NFS, username: 'user1', password: 'pass1' }],
    };

    const expectedPayload = {
      id: transactionId,
      status: ResponseStatus.PENDING,
      taskType: TaskType.VALIDATE_CONNECTION,
      transactionId,
      workerId: '',
      operations: [
        {
          operation: Operations.VALIDATE_NFS_CONNECTION,
          request: { hostname: 'host1', username: 'user1', password: 'pass1' },
          status: ResponseStatus.PENDING,
        },
      ],
    };

    const result = service.baseValidateConnectionReq(details as any, transactionId);

    expect(result).toEqual(expectedPayload);
  });

  it('should throw NotFoundException if config does not exist', async () => {
    (fileConfigService.getPathConfig as jest.Mock).mockResolvedValue(null);

    const configId = 'non-existent-config';

    await expect(service.fetchPaths(configId)).rejects.toThrow(
      NotFoundException,
    );

    expect(fileConfigService.getPathConfig).toHaveBeenCalledWith(configId);
  });

  it('should handle fetchPaths correctly', async () => {
    const configId = 'test-config-id';
    const transactionId = 'test-transaction-id';
    const config = {
      fileServers: [
        {
          protocol: 'NFS',
          host: 'host1',
          userName: 'user1',
          password: 'pass1',
          workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }],
        },
        {
          protocol: 'SMB',
          host: 'host2',
          userName: 'user2',
          password: 'pass2',
          workers: [{ workerId: 'worker1' }],
        },
      ],
    };

    const expectedMap = new Map<string, Omit<Credentials, 'workers'>[]>();
    expectedMap.set('worker1', [
      {
        protocol: Protocol.NFS,
        details: { hostname: 'host1', username: 'user1', password: 'pass1' },
      },
      {
        protocol: Protocol.SMB,
        details: { hostname: 'host2', username: 'user2', password: 'pass2' },
      },
    ]);
    expectedMap.set('worker2', [
      {
        protocol: Protocol.NFS,
        details: { hostname: 'host1', username: 'user1', password: 'pass1' },
      },
    ]);

    (fileConfigService.getPathConfig as jest.Mock).mockResolvedValue(config);
    jest.spyOn(service, 'fetchPathNotify').mockImplementation(async () => {});
    (fileConfigService.updateRefetchingConfig as jest.Mock).mockResolvedValue(
      true,
    );

    const result = await service.fetchPaths(configId);

    expect(fileConfigService.getPathConfig).toHaveBeenCalledWith(configId);
    expect(service.fetchPathNotify).toHaveBeenCalled();
    expect(fileConfigService.updateRefetchingConfig).toHaveBeenCalledWith(
      config,
    );
    expect(result).toBe(true);
  });

  it('should return paginated results', async () => {
    const requestDTO: WorkerRequestDTO = {
      page: '1',
      limit: '2',
      sort: 'createdAt',
      order: 'asc',
    };

    const mockData = [
      { id: 1, response: '{"key":"value"}', createdAt: new Date() },
      { id: 2, response: '{"key":"value2"}', createdAt: new Date() },
    ];

    const total = 10;

    (repository.find as jest.Mock).mockResolvedValue(mockData);
    (repository.count as jest.Mock).mockResolvedValue(total);

    const result = await service.processWorkerResponses(requestDTO);

    expect(repository.find).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: 'asc' },
      skip: 0,
      take: 2,
    });
    expect(repository.count).toHaveBeenCalledWith({ where: {} });
    expect(result).toEqual({ data: mockData, total });
  });

  it('should handle filtering and deserialization correctly', async () => {
    const requestDTO: WorkerRequestDTO = {
      deserialize: true,
      taskType: TaskType.LIST_PATHS,
      status: ResponseStatus.COMPLETED,
    };

    const mockData = [
      { id: 1, response: '{"key":"value"}', createdAt: new Date() },
      { id: 2, response: null, createdAt: new Date() },
    ];

    const total = 2;

    (repository.find as jest.Mock).mockResolvedValue(mockData);
    (repository.count as jest.Mock).mockResolvedValue(total);

    const result = await service.processWorkerResponses(requestDTO);

    expect(repository.find).toHaveBeenCalledWith({
      where: { taskType:  TaskType.LIST_PATHS, status: ResponseStatus.COMPLETED},
      order: { createdAt: 'ASC' },
    });
    expect(result.data).toEqual([
      { ...mockData[0], response: { key: 'value' } },
      { ...mockData[1], response: '' },
    ]);
    expect(result.total).toEqual(total);
  });

  it('should return all data when no pagination is provided', async () => {
    const requestDTO: WorkerRequestDTO = {};

    const mockData = [
      { id: 1, response: '{"key":"value"}', createdAt: new Date() },
      { id: 2, response: '{"key":"value2"}', createdAt: new Date() },
    ];

    const total = 2;

    (repository.find as jest.Mock).mockResolvedValue(mockData);
    (repository.count as jest.Mock).mockResolvedValue(total);

    const result = await service.processWorkerResponses(requestDTO);

    expect(repository.find).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: 'ASC' },
    });

  });
});
