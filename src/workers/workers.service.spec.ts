import { Test, TestingModule } from '@nestjs/testing';
import { WorkersService } from './workers.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkersStatusPageDto } from './dto/workers.page.dto';
import { WorkerStatus } from 'src/constants/enums';

describe('WorkersService', () => {
  let service: WorkersService;
  let repository: Repository<WorkerEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkersService,
        {
          provide: getRepositoryToken(WorkerEntity),
          useValue: {
            find: jest.fn(),
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<WorkersService>(WorkersService);
    repository = module.get<Repository<WorkerEntity>>(getRepositoryToken(WorkerEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllWorkers', () => {
    it('should return paginated data with count', async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: '1',
        limit: '10',
        sort: 'name',
        order: 'asc',
        workerId: '345678',
        workerName: 'test',
        clientId: 'asd',
        ipAddress: '121.12.12.2',
        projectId: '234',
        status: WorkerStatus.Online
      };
      const workers = [{ id: '1', name: 'Worker1' }, { id: '2', name: 'Worker2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: workers, total });
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          workerId: '345678',
          workerName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          projectId: '234',
          status: WorkerStatus.Online,
        },
        order: { name: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          workerId: '345678',
          workerName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          projectId: '234',
          status: WorkerStatus.Online,
        },
      });
    });

    it('should return data without pagination if no page and limit are provided', async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        sort: 'name',
        order: 'asc',
        // additional filters
      };
      const workers = [{ id: '1', name: 'Worker1' }, { id: '2', name: 'Worker2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: workers, total });
      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'asc' },
      });
      expect(repository.count).toHaveBeenCalled();
    });

    it('should return an empty result when no workers are found', async () => {
      const workerStatusPageDto: WorkersStatusPageDto = { page: '1', limit: '10' };
      jest.spyOn(repository, 'find').mockResolvedValueOnce([]);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(0);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: [], total: 0 });
      expect(repository.find).toHaveBeenCalled();
      expect(repository.count).toHaveBeenCalled();
    });

    it('should handle repository errors', async () => {
      const workerStatusPageDto: WorkersStatusPageDto = { page: '1', limit: '10' };
      jest.spyOn(repository, 'find').mockRejectedValueOnce(new Error('Database error'));

      await expect(service.findAllWorkers(workerStatusPageDto)).rejects.toThrow('Database error');
      expect(repository.find).toHaveBeenCalled();
    });

    it('should return paginated data with count for job run id', async () => {
      const workerStatusPageDto: WorkersStatusPageDto = {
        page: '1',
        limit: '10',
        sort: 'name',
        order: 'asc',
        workerId: '345678',
        workerName: 'test',
        clientId: 'asd',
        ipAddress: '121.12.12.2',
        projectId: '234',
        jobRunId: '123',
        status: WorkerStatus.Online
      };
      const workers = [{ id: '1', name: 'Worker1' }, { id: '2', name: 'Worker2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValueOnce(workers as any);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllWorkers(workerStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: workers, total });
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          workerId: '345678',
          workerName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          jobRunMap: { jobRunId: '123' },
          projectId: '234',
          status: WorkerStatus.Online,
        },
        order: { name: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          workerId: '345678',
          workerName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          jobRunMap: { jobRunId: '123' },
          projectId: '234',
          status: WorkerStatus.Online,
        },
      });
    });
  });
});
