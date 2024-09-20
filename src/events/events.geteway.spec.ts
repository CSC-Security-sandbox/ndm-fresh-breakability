import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { AgentStatus } from 'src/constants/enums';
import { ResponseStatus, SocketEvents } from 'src/constants/status';
import { AgentEntity } from 'src/entities/agent.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EventsGateway } from './events.gateway';
import { getRepositoryToken } from '@nestjs/typeorm';

jest.mock('src/auth/ws-jwt.middleware');
jest.mock('src/auth/ws-jwt/ws-jwt.guard');

class MockRepositor<T> extends Repository<T> {
    async save(e: any):Promise<any> {
        return e
    }
    async findOne(e: any):Promise<any> {
        return e
    }
    async update(e: any):Promise<any> {
        return e
    }
    async findOneBy(e: any):Promise<any> {
        return e
    }
  }


const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    findOneBy: jest.fn(),
    update: jest.fn()
};


describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let mockServer: Partial<Server>;
  let mockSocket: Partial<Socket>;
  let mockAgentRepository: MockRepositor<AgentEntity>
  let mockRequestTrackRepository: MockRepositor<RequestTrackEntity>
  let mockProjectRepository: MockRepositor<ProjectEntity>

  beforeEach(async () => {
    mockSocket = {
      handshake: {
        headers:{},
        query: {},
        address: "",
        auth:{},
        issued: 1,
        secure: true,
        time: "",
        url: "",
        xdomain: false
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
      id: 'socket-id',
      use: jest.fn(),
      to: jest.fn()
    };

    mockServer = {
        use:jest.fn(),
        to:jest.fn(),
        emit: jest.fn()
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        {
          provide: Server,
          useValue: mockServer,
        },
        {
            provide: getRepositoryToken(AgentEntity),
            useValue: mockRepository
        },
        {
            provide: getRepositoryToken(RequestTrackEntity),
            useValue: mockRepository
        },
        {
            provide: getRepositoryToken(ProjectEntity),
            useValue: mockRepository
        }
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    mockAgentRepository = module.get<MockRepositor<AgentEntity>>(getRepositoryToken(AgentEntity));
    mockRequestTrackRepository = module.get<MockRepositor<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity));
    mockProjectRepository = module.get<MockRepositor<ProjectEntity>>(getRepositoryToken(ProjectEntity));
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('afterInit', () => {
    it('should call SockateAuthMiddleware', () => {
      (mockSocket.use  as jest.Mock).mockImplementation((e)=>e);
      gateway.afterInit(mockSocket as Socket);
      expect(mockSocket.use).toHaveBeenCalledWith(SockateAuthMiddleware() as any);
    });
  });

  describe('handleConnection', () => {
    it('should handle connection and update agent', async () => {
      const agentId = 'agent-id';
      const agentName = 'agent-name';
      const projectId = 'project-id';
      mockSocket.handshake.query = { agentId, agentName, projectId };

      const mockAgent = { agentId, projectId, agentName, ipAddress: '127.0.0.1', status: AgentStatus.Online, clientId: 'socket-id' };
      (mockAgentRepository.findOne as jest.Mock).mockResolvedValue(mockAgent);
      (mockAgentRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      const mockProject = { id: projectId };
      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue(mockProject);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockAgentRepository.update).toHaveBeenCalledWith({ agentId }, { agentName, clientId: 'socket-id', status: AgentStatus.Online });
    });

    it('should handle connection and create agent if not found', async () => {
      const agentId = 'agent-id';
      const agentName = 'agent-name';
      const projectId = 'project-id';
      mockSocket.handshake.query = { agentId, agentName, projectId };

      (mockProjectRepository.findOne as jest.Mock).mockResolvedValue(null);
      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue({ id: projectId } as any);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockAgentRepository.create).toHaveBeenCalled();
      expect(mockAgentRepository.save).toHaveBeenCalled();
    });

    it('should disconnect client if project is not found', async () => {
      const agentId = 'agent-id';
      const agentName = 'agent-name';
      const projectId = 'invalid-project-id';
      mockSocket.handshake.query = { agentId, agentName, projectId };

      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue(null);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(SocketEvents.Error, { error: `Record Not Found for Project: ${projectId} Unabel to register agent` });
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnection and update agent status', async () => {
      const agentId = 'agent-id';
      const projectId = 'project-id';
      mockSocket.handshake.query = { agentId, projectId };

      (mockAgentRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await gateway.handleDisconnect(mockSocket as Socket);

      expect(mockAgentRepository.update).toHaveBeenCalledWith({ projectId, agentId }, { status: AgentStatus.Offline });
    });
  });

  describe('handleMessage', () => {
    it('should handle acknowledgement message', async () => {
      const requestId = 'request-id';
      const result = { key: 'value' };
      const message = { requestId, result };

      await gateway.handleMessage(mockSocket as Socket, message);

      expect(mockRequestTrackRepository.update).toHaveBeenCalledWith({ id: requestId }, { status: ResponseStatus.Completed, response: JSON.stringify(result) });
    });

    it('should handle error in acknowledgement message', async () => {
      const requestId = 'request-id';
      const error = 'Some error';
      const message = { requestId, error };

      await gateway.handleMessage(mockSocket as Socket, message);

      expect(mockRequestTrackRepository.update).toHaveBeenCalledWith({ id: requestId }, { status: ResponseStatus.Error, response: JSON.stringify(error) });
    });
  });

  describe('sendMessage', () => {
    it('should send a message to all clients', () => {
      const eventName = 'test-event';
      const payload = { key: 'value' };

      (mockSocket.emit  as jest.Mock).mockImplementation((e)=>e);
      gateway.sendMessage(eventName, payload);

      expect(mockServer.emit).toHaveBeenCalledWith(eventName, payload);
    });
  });

  describe('sendToClient', () => {
    it('should send a message to a specific client', () => {
      const agentId = 'agent-id';
      const eventType = 'test-event';
      const message = { key: 'value' };
      (mockServer.to as jest.Mock).mockReturnThis();

      (gateway as any).clients.set(agentId, 'socket-id');
      gateway.sendToClient(agentId, eventType, message);

      expect(mockServer.to).toHaveBeenCalledWith('socket-id');
      expect(mockServer.emit).toHaveBeenCalledWith(eventType, message);
    });
  });
});
