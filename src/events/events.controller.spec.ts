import { Test, TestingModule } from '@nestjs/testing';
import { TestConnectionsDTO } from './dto/workerconnection.dto';
import { MountConnectionsDTO } from './dto/workermounts.dto';
import { WorkerRequestDTO } from './dto/responsefilter.dto';
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
            testWorkerConnections: jest.fn(),
            processWorkerResponses: jest.fn(),
            mountWorkerConnections: jest.fn(),
            deleteWorkerConnections: jest.fn(),
            fetchExportPath: jest.fn(),
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

  describe('testWorkerConnections', () => {
    it('should return a request ID on successful connection test', async () => {
      const testConnectionsDTO: TestConnectionsDTO = { workers: [], configId: "2345", validateConnection: false};
      const requestId = 'test-request-id';
      
      jest.spyOn(service, 'testWorkerConnections').mockResolvedValue({ requestId });

      expect(await controller.testWorkerConnections(testConnectionsDTO)).toEqual({ requestId });
    });
  });

  describe('getWorkerResponse', () => {
    it('should return a list of responses', async () => {
      const query: WorkerRequestDTO = {};
      const response= { data: [], total: 0 };

      jest.spyOn(service, 'processWorkerResponses').mockResolvedValue(response);

      expect(await controller.getWorkerResponse(query)).toEqual(response);
    });

    it('should handle invalid query parameters', async () => {
      const query: any = {  };

      jest.spyOn(service, 'processWorkerResponses').mockRejectedValue(new Error('Invalid parameters'));

      await expect(controller.getWorkerResponse(query)).rejects.toThrow('Invalid parameters');
    });
  });

  describe('fetchExportPath', () => {
    it('should return a request ID on successful mount', async () => {
      const mountConnectionsDTO: MountConnectionsDTO = {workers: [],configId:"1234",protocol:[] };
      const requestId = 'mount-request-id';

      jest.spyOn(service, 'mountWorkerConnections').mockResolvedValue({ requestId });

      expect(await controller.fetchExportPath(mountConnectionsDTO)).toEqual({ requestId });
    });
  });

});
