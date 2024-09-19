import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { RequestTrackEntity } from 'src/entities/requesttrack.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let server: Server;
  let agentRepo: Repository<AgentEntity>;
  let requestTrackRepo: Repository<RequestTrackEntity>;
  let projectRepo: Repository<ProjectEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        {
          provide: getRepositoryToken(AgentEntity),
          useValue: {
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RequestTrackEntity),
          useValue: {
            update: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ProjectEntity),
          useValue: {
            findOneBy: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    server = gateway['server'];
    agentRepo = module.get<Repository<AgentEntity>>(getRepositoryToken(AgentEntity));
    requestTrackRepo = module.get<Repository<RequestTrackEntity>>(getRepositoryToken(RequestTrackEntity));
    projectRepo = module.get<Repository<ProjectEntity>>(getRepositoryToken(ProjectEntity));
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('afterInit', () => {
    it('should initialize WebSocket server and apply middleware', () => {
      const client: Socket = {} as any; // Mock client
      const middlewareSpy = jest.spyOn(client, 'use');
      gateway.afterInit(client);
      expect(middlewareSpy).toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('should log client connection and update agent record', async () => {
      const client: any = {
        handshake: {
          query: {
            agentId: 'test-agent',
            agentName: 'Test Agent',
            projectId: 'test-project',
          },
          address: '127.0.0.1',
        },
        id: 'client-id',
      };
      const agent = { agentId: 'test-agent', projectId: 'test-project' };
      const project = { id: 'test-project' };
      
      jest.spyOn(agentRepo, 'findOne').mockResolvedValue(agent as any);
      jest.spyOn(agentRepo, 'update').mockResolvedValue({} as any);
      jest.spyOn(projectRepo, 'findOneBy').mockResolvedValue(project as any);

      await gateway.handleConnection(client);

      expect(agentRepo.findOne).toHaveBeenCalledWith({ where: { agentId: 'test-agent' } });
      expect(agentRepo.update).toHaveBeenCalledWith({ agentId: 'test-agent' }, { agentName: 'Test Agent', clientId: 'client-id', status: 'Online' });
    });

    it('should handle missing agent details and disconnect client', async () => {
      const client: any = {
        handshake: {
          query: {},
        },
        emit: jest.fn(),
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(client);
      
      expect(client.emit).toHaveBeenCalledWith('error', { error: 'Invalid Details' });
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle client disconnection and update agent status', async () => {
      const client: any = {
        handshake: {
          query: {
            agentId: 'test-agent',
            projectId: 'test-project',
          },
        },
        id: 'client-id',
      };

      jest.spyOn(agentRepo, 'update').mockResolvedValue({} as any);

      await gateway.handleDisconnect(client);

      expect(agentRepo.update).toHaveBeenCalledWith({ projectId: 'test-project', agentId: 'test-agent' }, { status: 'Offline' });
    });
  });

  describe('handleMessage', () => {
    it('should handle acknowledgement messages and update request track', async () => {
      const client: any = {
        handshake: {
          query: {
            agentId: 'test-agent',
          },
        },
      };
      const message = {
        requestId: 'request-id',
        error: null,
        result: 'test-result',
      };

      jest.spyOn(requestTrackRepo, 'update').mockResolvedValue({} as any);

      await gateway.handleMessage(client, message);

      expect(requestTrackRepo.update).toHaveBeenCalledWith({ id: 'request-id' }, { status: 'Completed', response: JSON.stringify('test-result') });
    });

    it('should handle error messages and update request track', async () => {
      const client: any = {
        handshake: {
          query: {
            agentId: 'test-agent',
          },
        },
      };
      const message = {
        requestId: 'request-id',
        error: 'test-error',
        result: null,
      };

      jest.spyOn(requestTrackRepo, 'update').mockResolvedValue({} as any);

      await gateway.handleMessage(client, message);

      expect(requestTrackRepo.update).toHaveBeenCalledWith({ id: 'request-id' }, { status: 'Error', response: JSON.stringify('test-error') });
    });
  });

  describe('sendMessage', () => {
    it('should emit a message to all clients', () => {
      const emitSpy = jest.spyOn(server, 'emit');
      const eventName = 'test-event';
      const payload = { test: 'payload' };

      gateway.sendMessage(eventName, payload);

      expect(emitSpy).toHaveBeenCalledWith(eventName, payload);
    });
  });

  describe('sendToClient', () => {
    it('should send a message to a specific client', () => {
      const agentId = 'test-agent';
      const eventType = 'test-event';
      const message = { test: 'payload' };
      const clientId = 'client-id';
      const emitSpy = jest.spyOn(server, 'to').mockReturnValue({
        emit: jest.fn(),
      } as any);

      gateway['clients'].set(agentId, clientId);

      gateway.sendToClient(agentId, eventType, message);

      expect(emitSpy).toHaveBeenCalledWith(clientId);
      // expect(emitSpy.emit).toHaveBeenCalledWith(eventType, message);
    });

    it('should not send a message if clientId is not found', () => {
      const agentId = 'test-agent';
      const eventType = 'test-event';
      const message = { test: 'payload' };

      const emitSpy = jest.spyOn(server, 'to').mockReturnValue({
        emit: jest.fn(),
      } as any);

      gateway['clients'].delete(agentId);

      gateway.sendToClient(agentId, eventType, message);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });
});
