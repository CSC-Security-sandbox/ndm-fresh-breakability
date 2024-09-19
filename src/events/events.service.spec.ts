import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EventsService } from './events.service';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { RabbtMqService } from './rabbitmq.service';
import { NFSConnectionDetails, SMBConnectionDetails, TestConnectionsDTO } from './dto/agentconnection.dto';
import { MountConnectionsDTO } from './dto/agentmounts.dto';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';
import { Protocol } from 'src/constants/enums';
import { RequestType, ResponseStatus, SocketEvents } from 'src/constants/status';

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
  let rabbitMqService: RabbtMqService;

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
          provide: RabbtMqService,
          useValue: {
            publishToExchange: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    repository = module.get<MockRepositor<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity));
    rabbitMqService = module.get<RabbtMqService>(RabbtMqService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});  // Mock Logger
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('testAgentConnetions', () => {
    it('should call makeTestConnectionnRequest for each agent', async () => {
      const testConnectionsDTO: TestConnectionsDTO = {
        agents: [{ agentId: 'agent1' }, { agentId: 'agent2' }],
        nfsConnectionDetails: {} as NFSConnectionDetails,
        sbmConnectionDetails: {} as SMBConnectionDetails,
        configId: 'config1',
      } as TestConnectionsDTO;
      const makeTestConnectionnRequestSpy = jest.spyOn(service, 'makeTestConnectionnRequest').mockResolvedValue(undefined);

      await service.testAgentConnetions(testConnectionsDTO);

      expect(makeTestConnectionnRequestSpy).toHaveBeenCalledTimes(4);  // 2 agents * 2 protocols
    });
  });

  describe('makeTestConnectionnRequest', () => {
    it('should save requestTrack and notify agent', async () => {
      const requestId = uuidv4();
      const agentId = 'agent1';
      const connection = {} as SMBConnectionDetails;
      const protocol = Protocol.SMB;
      const configId = 'config1';

      jest.spyOn(repository, 'save').mockResolvedValue({ id: '1' } as any);
      const notifyEventToAgentSpy = jest.spyOn(service, 'notifyEventToAgent').mockResolvedValue();

      await service.makeTestConnectionnRequest(requestId, agentId, connection, protocol, configId);

      expect(repository.save).toHaveBeenCalled();
      expect(notifyEventToAgentSpy).toHaveBeenCalled();
    });
  });

  describe('mountAgentConnetions', () => {
    it('should call makeAgentMountConnectionRequest for each agent and protocol', async () => {
      const mountConnectionsDTO: MountConnectionsDTO = {
        agents: [{ agentId: 'agent1' }, { agentId: 'agent2' }],
        protocol: [Protocol.NFS, Protocol.SMB],
        configId: 'config1',
      };
      const makeAgentMountConnectionRequestSpy = jest.spyOn(service, 'makeAgentMountConnectionRequest').mockResolvedValue(undefined);

      await service.mountAgentConnetions(mountConnectionsDTO);

      expect(makeAgentMountConnectionRequestSpy).toHaveBeenCalledTimes(4);  // 2 agents * 2 protocols
    });
  });

  describe('makeAgentMountConnectionRequest', () => {
    it('should save requestTrack and notify agent', async () => {
      const requestId = uuidv4();
      const agentId = 'agent1';
      const protocol = Protocol.SMB;
      const configId = 'config1';

      jest.spyOn(repository, 'save').mockResolvedValue({ id: '1' } as any);
      const notifyEventToAgentSpy = jest.spyOn(service, 'notifyEventToAgent').mockResolvedValue();

      await service.makeAgentMountConnectionRequest(requestId, agentId, protocol, configId);

      expect(repository.save).toHaveBeenCalled();
      expect(notifyEventToAgentSpy).toHaveBeenCalled();
    });
  });

  describe('notifyEventToAgent', () => {
    it('should publish event to RabbitMQ', async () => {
      const agentId = 'agent1';
      const socketEvents = SocketEvents.TestConnection;
      const payload = { requestId: '1' };

      await service.notifyEventToAgent(agentId, socketEvents, payload);

      expect(rabbitMqService.publishToExchange).toHaveBeenCalledWith({
        agentId,
        action: {
          eventType: socketEvents,
          message: payload,
        },
      });
    });
  });

  describe('findAllResponse', () => {
    it('should return paginated results if page and limit are provided', async () => {
      const responsePageFilterDto: ResponsePageFilterDto = {
        page: '1',
        limit: '10',
        sort: 'createdAt',
        order: 'asc',
      };

      jest.spyOn(repository, 'find').mockResolvedValue([{ id: '1' } as any]);
      jest.spyOn(repository, 'count').mockResolvedValue(1);

      const result = await service.findAllResponse(responsePageFilterDto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should return all results if page and limit are not provided', async () => {
      const responsePageFilterDto: ResponsePageFilterDto = {};

      jest.spyOn(repository, 'find').mockResolvedValue([{ id: '1' } as any]);
      jest.spyOn(repository, 'count').mockResolvedValue(1);

      const result = await service.findAllResponse(responsePageFilterDto);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });
});
