import { Test, TestingModule } from '@nestjs/testing';
import { TestConnectionsDTO } from './dto/workerconnection.dto';
import { MountConnectionsDTO } from './dto/workermounts.dto';
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
            testWorkerConnetions: jest.fn(),
            findAllResponse: jest.fn(),
            mountWorkerConnetions: jest.fn(),
            deleteWorkerConnetions: jest.fn(),
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

  describe('testWorkerConnetions', () => {
    it('should return a request ID on successful connection test', async () => {
      const testConnectionsDTO: TestConnectionsDTO = { workers: [], configId: "2345", validateConnection: false};
      const requestId = 'test-request-id';
      
      jest.spyOn(service, 'testWorkerConnetions').mockResolvedValue({ requestId });

      expect(await controller.testWorkerConnetions(testConnectionsDTO)).toEqual({ requestId });
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

  describe('mountsWorkerConnetions', () => {
    it('should return a request ID on successful mount', async () => {
      const mountConnectionsDTO: MountConnectionsDTO = {workers: [],configId:"1234",protocol:[] };
      const requestId = 'mount-request-id';

      jest.spyOn(service, 'mountWorkerConnetions').mockResolvedValue({ requestId });

      expect(await controller.mountsWorkerConnetions(mountConnectionsDTO)).toEqual({ requestId });
    });
  });

});
