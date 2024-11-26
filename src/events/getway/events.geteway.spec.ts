import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { SockateAuthMiddleware } from 'src/auth/ws-jwt.middleware';
import { WorkerStatus } from 'src/constants/enums';
import { SocketEvents } from 'src/constants/status';
import { ProjectEntity } from 'src/entities/project.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { Repository } from 'typeorm';
import { FileConfigService } from '../service/config.service';
import { RequestTrackService } from '../service/requesttrack.service';
import { EventsGateway } from './events.gateway';

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
  let mockWorkerRepository: MockRepositor<WorkerEntity>
  let mockRequestTrackRepository: MockRepositor<RequestTrackEntity>
  let mockProjectRepository: MockRepositor<ProjectEntity>
  let fileConfigService: FileConfigService;
  let requestTrackService: RequestTrackService

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
            provide: getRepositoryToken(WorkerEntity),
            useValue: mockRepository
        },
        {
            provide: getRepositoryToken(RequestTrackEntity),
            useValue: mockRepository
        },
        {
            provide: getRepositoryToken(ProjectEntity),
            useValue: mockRepository
        },
        {
          provide: FileConfigService,
          useValue: {
            updatePathToConfig: jest.fn(),
            getPathConfig: jest.fn(),
            updateRefetchingConfig: jest.fn(),
          },
        },
        {
          provide: RequestTrackService,
          useValue : {
            validateConnectionACk: jest.fn()
          }
        }
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    mockWorkerRepository = module.get<MockRepositor<WorkerEntity>>(getRepositoryToken(WorkerEntity));
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
    it('should handle connection and update worker', async () => {
      const workerId = 'worker-id';
      const workerName = 'worker-name';
      const projectId = 'project-id';
      mockSocket.handshake.query = {worker: workerId, workerName, projectId };

      const mockWorker = { workerId, projectId, workerName, ipAddress: '127.0.0.1', status: WorkerStatus.Online, clientId: 'socket-id' };
      (mockWorkerRepository.findOne as jest.Mock).mockResolvedValue(mockWorker);
      (mockWorkerRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      const mockProject = { id: projectId };
      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue(mockProject);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockWorkerRepository.update).toHaveBeenCalledWith({ workerId }, { workerName, clientId: 'socket-id', status: WorkerStatus.Online });
    });

    it('should handle connection and create worker if not found', async () => {
      const workerId = 'worker-id';
      const workerName = 'worker-name';
      const projectId = 'project-id';
      mockSocket.handshake.query = {worker: workerId, workerName, projectId };

      (mockProjectRepository.findOne as jest.Mock).mockResolvedValue(null);
      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue({ id: projectId } as any);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockWorkerRepository.create).toHaveBeenCalled();
      expect(mockWorkerRepository.save).toHaveBeenCalled();
    });

    it('should disconnect client if project is not found', async () => {
      const workerId = 'worker-id';
      const workerName = 'worker-name';
      const projectId = 'invalid-project-id';
      mockSocket.handshake.query = { worker:workerId, workerName, projectId };

      (mockProjectRepository.findOneBy as jest.Mock).mockResolvedValue(null);

      await gateway.handleConnection(mockSocket as Socket);

      expect(mockSocket.emit).toHaveBeenCalledWith(SocketEvents.ERROR, { error: `Record Not Found for Project: ${projectId} Unable to register worker` });
      expect(mockSocket.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnection and update worker status', async () => {
      const workerId = 'worker-id';
      const projectId = 'project-id';
      mockSocket.handshake.query = { worker:workerId, projectId };

      (mockWorkerRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      await gateway.handleDisconnect(mockSocket as Socket);

      expect(mockWorkerRepository.update).toHaveBeenCalledWith({ projectId, workerId }, { status: WorkerStatus.Offline });
    });
  });

  describe('sendMessage', () => {
    it('should send a message to all clients', () => {
      const eventName = 'test-event';
      const payload = { key: 'value' };

      (gateway as any).server = mockSocket;
      (mockSocket.emit  as jest.Mock).mockImplementation((e)=>e);
      gateway.sendMessage(eventName, payload);

      expect(mockServer.emit).toBeDefined();
    });
  });

  describe('sendToClient', () => {
    it('should send not send message to a specific client if not connected', () => {
      const workerId = 'worker-id';
      const eventType = 'test-event';
      const message = { key: 'value' };
      (mockServer.to as jest.Mock).mockReturnThis();
      (gateway as any).server = mockSocket;

      (gateway as any).clients.set(workerId, undefined);
      gateway.sendToClient(workerId, eventType, message);

      expect(mockServer.to).toBeDefined();
    });

    it('should send a message to a specific client', () => {
      const workerId = 'worker-id';
      const eventType = 'test-event';
      const message = { key: 'value' };
      (gateway as any).server = {...mockServer, to: jest.fn().mockReturnValue(mockServer)};
      (gateway as any).clients.set(workerId, mockSocket);
      gateway.sendToClient(workerId, eventType, message);
      expect(mockServer.to).toBeDefined();
    });
    
  });
});
