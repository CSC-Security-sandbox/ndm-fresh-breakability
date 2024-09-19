import { Test, TestingModule } from '@nestjs/testing';
import { TestConnectionsDTO } from './dto/agentconnection.dto';
import { MountConnectionsDTO } from './dto/agentmounts.dto';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

describe('EventsController', () => {
  let controller: EventsController;
  let service: EventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        {
          provide: EventsService,
          useValue: {
            testAgentConnetions: jest.fn(),
            findAllResponse: jest.fn(),
            mountAgentConnetions: jest.fn(),
            deleteAgentConnetions: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('testAgentConnetions', () => {
    it('should return a request ID on successful connection test', async () => {
      const testConnectionsDTO: TestConnectionsDTO = { agents: [], configId: "2345", validateConnection: false};
      const requestId = 'test-request-id';
      
      jest.spyOn(service, 'testAgentConnetions').mockResolvedValue({ requestId });

      expect(await controller.testAgentConnetions(testConnectionsDTO)).toEqual({ requestId });
    });
  });

  describe('getResponse', () => {
    it('should return a list of responses', async () => {
      const query: ResponsePageFilterDto = { /* mock query parameters */ };
      const response= { data: [], total: 0 };

      jest.spyOn(service, 'findAllResponse').mockResolvedValue(response);

      expect(await controller.getResponse(query)).toEqual(response);
    });

    it('should handle invalid query parameters', async () => {
      const query: any = { /* invalid parameters */ };

      // Mock or validate behavior on invalid parameters if necessary
      jest.spyOn(service, 'findAllResponse').mockRejectedValue(new Error('Invalid parameters'));

      await expect(controller.getResponse(query)).rejects.toThrow('Invalid parameters');
    });
  });

  describe('mountsAgentConnetions', () => {
    it('should return a request ID on successful mount', async () => {
      const mountConnectionsDTO: MountConnectionsDTO = {agents: [],configId:"1234",protocol:[] };
      const requestId = 'mount-request-id';

      jest.spyOn(service, 'mountAgentConnetions').mockResolvedValue({ requestId });

      expect(await controller.mountsAgentConnetions(mountConnectionsDTO)).toEqual({ requestId });
    });
  });

});
