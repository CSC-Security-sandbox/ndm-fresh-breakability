import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Protocol } from 'src/constants/enums';
import { SocketEvents } from 'src/constants/status';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './dto/workerconnection.dto';
import { MountConnectionsDTO } from './dto/workermounts.dto';
import { WorkerRequestDTO } from './dto/responsefilter.dto';
import { EventsService } from './events.service';
import { RabbitMqService } from './rabbitmq.service';

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
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    repository = module.get<MockRepositor<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity));
    rabbitMqService = module.get<RabbitMqService>(RabbitMqService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});  
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('testWorkerConnections', () => {
    it('should call verifyWorkerConnection for each worker', async () => {
      const testConnectionsDTO: TestConnectionsDTO = {
        workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }],
        nfsConnectionDetails: {} as NFSConnectionDetails,
        sbmConnectionDetails: {} as SMBConnectionDetails,
        configId: 'config1',
      } as TestConnectionsDTO;
      const makeTestConnectionnRequestSpy = jest.spyOn(service, 'verifyWorkerConnection').mockResolvedValue(undefined);

      await service.testWorkerConnections(testConnectionsDTO);

      expect(makeTestConnectionnRequestSpy).toHaveBeenCalledTimes(4); 
    });
  });

  describe('verifyWorkerConnection', () => {
    it('should save requestTrack and notify worker', async () => {
      const requestId = uuidv4();
      const workerId = 'worker1';
      const connection = {} as SMBConnectionDetails;
      const protocol = Protocol.SMB;
      const configId = 'config1';

      jest.spyOn(repository, 'save').mockResolvedValue({ id: '1' } as any);
      const notifyEventToWorkerSpy = jest.spyOn(service, 'notifyEventToWorker').mockResolvedValue();

      await service.verifyWorkerConnection(requestId, workerId, connection, protocol, configId);

      expect(repository.save).toHaveBeenCalled();
      expect(notifyEventToWorkerSpy).toHaveBeenCalled();
    });
  });

  describe('mountWorkerConnections', () => {
    it('should call fetchExportPath for each worker and protocol', async () => {
      const mountConnectionsDTO: MountConnectionsDTO = {
        workers: [{ workerId: 'worker1' }, { workerId: 'worker2' }],
        protocol: [Protocol.NFS, Protocol.SMB],
        configId: 'config1',
      };
      const makeWorkerMountConnectionRequestSpy = jest.spyOn(service, 'fetchExportPath').mockResolvedValue(undefined);

      await service.mountWorkerConnections(mountConnectionsDTO);

      expect(makeWorkerMountConnectionRequestSpy).toHaveBeenCalledTimes(4);  // 2 workers * 2 protocols
    });
  });

  describe('fetchExportPath', () => {
    it('should save requestTrack and notify worker', async () => {
      const requestId = uuidv4();
      const workerId = 'worker1';
      const protocol = Protocol.SMB;
      const configId = 'config1';

      jest.spyOn(repository, 'save').mockResolvedValue({ id: '1' } as any);
      const notifyEventToWorkerSpy = jest.spyOn(service, 'notifyEventToWorker').mockResolvedValue();

      await service.fetchExportPath(requestId, workerId, protocol, configId);

      expect(repository.save).toHaveBeenCalled();
      expect(notifyEventToWorkerSpy).toHaveBeenCalled();
    });
  });

  describe('notifyEventToWorker', () => {
    it('should publish event to RabbitMQ', async () => {
      const workerId = 'worker1';
      const socketEvents = SocketEvents.TestConnection;
      const payload = { requestId: '1' };

      await service.notifyEventToWorker(workerId, socketEvents, payload);

      expect(rabbitMqService.publishToExchange).toHaveBeenCalledWith({
        workerId,
        action: {
          eventType: socketEvents,
          message: payload,
        },
      });
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
});
