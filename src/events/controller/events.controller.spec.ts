import { Test, TestingModule } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventsService } from '../service/events.service';
import { ValidateConnectionDto } from '../dto/validateconnection.dto';
import { WorkerRequestDTO } from '../dto/responsefilter.dto';
import { Protocol } from 'src/constants/enums';

describe('EventsController', () => {
  let controller: EventsController;
  let eventsService: EventsService;

  const mockEventsService = {
    validateWorkerConnection: jest.fn(),
    processWorkerResponses: jest.fn(),
    fetchPaths: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
      ],
    }).compile();

    controller = module.get<EventsController>(EventsController);
    eventsService = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('testWorkerConnections', () => {
    it('should call validateWorkerConnection with correct parameters', async () => {
      const dto: ValidateConnectionDto = {
        hostname: 'localhost',
        protocols: [{ protocol: Protocol.NFS, username: 'user', password: 'pass' }],
        workers: ['worker-1'],
      };

      mockEventsService.validateWorkerConnection.mockResolvedValue('RequestId123');

      const result = await controller.testWorkerConnections(dto);

      expect(mockEventsService.validateWorkerConnection).toHaveBeenCalledWith(dto);
      expect(result).toBe('RequestId123');
    });
  });

  describe('getWorkerResponse', () => {
    it('should call processWorkerResponses with correct parameters', async () => {
      const filterDto: WorkerRequestDTO = {
        page: '1',
        limit: '10',
        sort: 'createdAt',
        order: 'asc',
        deserialize: false,
      };

      const response = { data: [], total: 0 };
      mockEventsService.processWorkerResponses.mockResolvedValue(response);

      const result = await controller.getWorkerResponse(filterDto);

      expect(mockEventsService.processWorkerResponses).toHaveBeenCalledWith(filterDto);
      expect(result).toEqual(response);
    });
  });

  describe('refetchExportPath', () => {
    it('should call fetchPaths with correct parameters', async () => {
      const configId = 'config-123';

      mockEventsService.fetchPaths.mockResolvedValue('Success');

      const result = await controller.refetchExportPath(configId);

      expect(mockEventsService.fetchPaths).toHaveBeenCalledWith(configId);
      expect(result).toBe('Success');
    });
  });
});
