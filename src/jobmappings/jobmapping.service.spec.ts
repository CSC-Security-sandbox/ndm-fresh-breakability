import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { JobMappingService } from './jobmapping.service';
import { JobMappingEntity } from '../entities/jobmapping.entity';

const mockJobMappingRepository = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('JobMappingService', () => {
  let service: JobMappingService;
  let repo: Repository<JobMappingEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobMappingService,
        {
          provide: getRepositoryToken(JobMappingEntity),
          useValue: mockJobMappingRepository, // Use the mock repository here
        },
      ],
    }).compile();

    service = module.get<JobMappingService>(JobMappingService);
    repo = module.get<Repository<JobMappingEntity>>(getRepositoryToken(JobMappingEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all job mappings', async () => {
      const jobMappings = [
        { id: '1', job_config_id: 'uuid1', type: 'GID', source_id: 'src1', destination_id: 'dst1' },
      ];
      mockJobMappingRepository.find.mockResolvedValue(jobMappings); // Mock the find method

      const result = await service.findAll();
      expect(result).toEqual(jobMappings);
      expect(mockJobMappingRepository.find).toHaveBeenCalledTimes(1); // Check the mock method
    });
  });

  describe('getById', () => {
    it('should return a job mapping by ID', async () => {
      const jobMapping = { id: '1', job_config_id: 'uuid1', type: 'GID', source_id: 'src1', destination_id: 'dst1' };
      mockJobMappingRepository.findOne.mockResolvedValue(jobMapping);

      const result = await service.findOne('1');
      expect(result).toEqual(jobMapping);
    });
  });
});
