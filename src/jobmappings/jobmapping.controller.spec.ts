import { Test, TestingModule } from '@nestjs/testing';
import { JobMappingController } from './jobmapping.controller';
import { JobMappingService } from './jobmapping.service';
import { JobIdMappingType } from 'src/entities/jobmapping.entity';

const mockJobMappingService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('JobMappingController', () => {
  let controller: JobMappingController;
  let service: JobMappingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobMappingController],
      providers: [
        {
          provide: JobMappingService,
          useValue: mockJobMappingService,
        },
      ],
    }).compile();

    controller = module.get<JobMappingController>(JobMappingController);
    service = module.get<JobMappingService>(JobMappingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all job mappings', async () => {
      const jobMappings = [{ id: '1', job_config_id: 'uuid1', type: JobIdMappingType.Uid, source_id: 'src1', destination_id: 'dst1' }];
      mockJobMappingService.findAll.mockResolvedValue(jobMappings);

      const result = await controller.getAll();
      expect(result).toEqual(jobMappings);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getById', () => {
    it('should return a job mapping by ID', async () => {
      const jobMapping = { id: '1', job_config_id: 'uuid1', type: JobIdMappingType.Uid, source_id: 'src1', destination_id: 'dst1' };
      mockJobMappingService.findOne.mockResolvedValue(jobMapping);

      const result = await controller.getById('1');
      expect(result).toEqual(jobMapping);
    });

    it('should throw an error if the job mapping is not found', async () => {
      mockJobMappingService.findOne.mockResolvedValue(null);

      await expect(controller.getById('1')).rejects.toThrow('Job mapping not found');
    });
  });

  describe('create', () => {
    it('should create a new job mapping', async () => {
      const createDto = { job_config_id: 'uuid1', type: JobIdMappingType.Uid, source_id: 'src1', destination_id: 'dst1' };
      const jobMapping = { id: '1', ...createDto };

      mockJobMappingService.create.mockResolvedValue(jobMapping);

      const result = await controller.create(createDto);
      expect(result).toEqual(jobMapping);
    });
  });

  describe('update', () => {
    it('should update an existing job mapping', async () => {
      const updateDto = { type: JobIdMappingType.Gid };
      const updatedJobMapping = { id: '1', job_config_id: 'uuid1', type: JobIdMappingType.Uid, source_id: 'src1', destination_id: 'dst1' };

      mockJobMappingService.update.mockResolvedValue(updatedJobMapping);

      const result = await controller.update('1', updateDto);
      expect(result).toEqual(updatedJobMapping);
    });

    it('should throw an error if the job mapping is not found', async () => {
      mockJobMappingService.update.mockResolvedValue(null);

      await expect(controller.update('1', { type: JobIdMappingType.Uid })).rejects.toThrow('Job mapping not found');
    });
  });

  describe('delete', () => {
    it('should delete a job mapping', async () => {
      mockJobMappingService.delete.mockResolvedValue(true);

      const result = await controller.delete('1');
      expect(result).toEqual({ message: 'Job mapping deleted successfully' });
    });

    it('should throw an error if the job mapping is not found', async () => {
      mockJobMappingService.delete.mockResolvedValue(false);

      await expect(controller.delete('1')).rejects.toThrow('Job mapping not found');
    });
  });
});