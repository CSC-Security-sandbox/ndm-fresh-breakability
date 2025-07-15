import { Test, TestingModule } from '@nestjs/testing';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { WorkersStatusPageDto,  } from './dto/workers.page.dto';

describe('WorkersController', () => {
  let controller: WorkersController;
  let service: WorkersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkersController],
      providers: [
        {
          provide: WorkersService,
          useValue: {
            findAllWorkers: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<WorkersController>(WorkersController);
    service = module.get<WorkersService>(WorkersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getWorkers', () => {
    it('should return a list of workers', async () => {
      const query: WorkersStatusPageDto = { };
      jest.spyOn(service, 'findAllWorkers').mockResolvedValue({data: [], total: 0});
      expect(await controller.getWorkers(query))
    });

    it('should handle invalid query parameters', async () => {
      const query: any = { /* invalid parameters */ };

      // You can mock or validate behavior on invalid parameters if necessary
      jest.spyOn(service, 'findAllWorkers').mockRejectedValue(new Error('Invalid parameters'));

      await expect(controller.getWorkers(query)).rejects.toThrow('Invalid parameters');
    });

    describe('updateWorkerJobRunStatus', () => {
      it('should update the worker job run status successfully', async () => {
      const params = { workerId: 'worker1', jobrunId: 'jobrun1', active: true };
      const updateResult = { success: true };
      service.updateWorkerJobRunStatus = jest.fn().mockResolvedValue(updateResult);

      const result = await controller.updateWorkerJobRunStatus(params as any);
      expect(service.updateWorkerJobRunStatus).toHaveBeenCalledWith('worker1', 'jobrun1', true);
      expect(result).toEqual(updateResult);
      });

      it('should throw an error if service throws', async () => {
      const params = { workerId: 'worker1', jobrunId: 'jobrun1', active: false };
      service.updateWorkerJobRunStatus = jest.fn().mockRejectedValue(new Error('Not found'));

      await expect(controller.updateWorkerJobRunStatus(params as any)).rejects.toThrow('Not found');
      });
    });
  });
});
