import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { SoftDeleteJobConfigRepository } from './soft-delete-jobconfig.repository';

describe('SoftDeleteJobConfigRepository', () => {
  let softDeleteRepo: SoftDeleteJobConfigRepository;
  let underlyingRepo: jest.Mocked<Repository<JobConfigEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoftDeleteJobConfigRepository,
        {
          provide: getRepositoryToken(JobConfigEntity),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            findAndCount: jest.fn().mockResolvedValue([[], 0]),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn().mockReturnValue({}),
            save: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            remove: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
            query: jest.fn().mockResolvedValue([]),
            manager: { transaction: jest.fn() },
            metadata: {},
            target: JobConfigEntity,
          },
        },
      ],
    }).compile();

    softDeleteRepo = module.get<SoftDeleteJobConfigRepository>(SoftDeleteJobConfigRepository);
    underlyingRepo = module.get(getRepositoryToken(JobConfigEntity));
  });

  it('should be defined', () => {
    expect(softDeleteRepo).toBeDefined();
  });

  // ------------------------------------------------------------------ //
  //  injectSoftDeleteFilter — branch coverage                          //
  // ------------------------------------------------------------------ //

  describe('injectSoftDeleteFilter (via find methods)', () => {
    it('should inject isDeleted: false when options is undefined', async () => {
      await softDeleteRepo.find();
      expect(underlyingRepo.find).toHaveBeenCalledWith({
        where: { isDeleted: false },
      });
    });

    it('should inject isDeleted: false when options has no where clause', async () => {
      await softDeleteRepo.find({});
      expect(underlyingRepo.find).toHaveBeenCalledWith({
        where: { isDeleted: false },
      });
    });

    it('should inject isDeleted: false into an object where clause', async () => {
      await softDeleteRepo.find({ where: { id: '123' } as any });
      expect(underlyingRepo.find).toHaveBeenCalledWith({
        where: { id: '123', isDeleted: false },
      });
    });

    it('should inject isDeleted: false into each element of an array where clause', async () => {
      await softDeleteRepo.find({
        where: [
          { id: 'a' } as any,
          { id: 'b' } as any,
        ],
      });
      expect(underlyingRepo.find).toHaveBeenCalledWith({
        where: [
          { id: 'a', isDeleted: false },
          { id: 'b', isDeleted: false },
        ],
      });
    });

    it('should preserve other options alongside where', async () => {
      await softDeleteRepo.find({
        where: { id: '1' } as any,
        relations: ['jobRuns'],
        order: { id: 'ASC' } as any,
      });
      expect(underlyingRepo.find).toHaveBeenCalledWith({
        where: { id: '1', isDeleted: false },
        relations: ['jobRuns'],
        order: { id: 'ASC' },
      });
    });
  });

  // ------------------------------------------------------------------ //
  //  findOne                                                            //
  // ------------------------------------------------------------------ //

  describe('findOne', () => {
    it('should inject isDeleted: false into findOne options', async () => {
      await softDeleteRepo.findOne({ where: { id: '123' } as any });
      expect(underlyingRepo.findOne).toHaveBeenCalledWith({
        where: { id: '123', isDeleted: false },
      });
    });

    it('should inject isDeleted: false with relations', async () => {
      await softDeleteRepo.findOne({
        where: { id: '456' } as any,
        relations: { sourcePath: true } as any,
      });
      expect(underlyingRepo.findOne).toHaveBeenCalledWith({
        where: { id: '456', isDeleted: false },
        relations: { sourcePath: true },
      });
    });
  });

  // ------------------------------------------------------------------ //
  //  findAndCount                                                       //
  // ------------------------------------------------------------------ //

  describe('findAndCount', () => {
    it('should inject isDeleted: false when options is undefined', async () => {
      await softDeleteRepo.findAndCount();
      expect(underlyingRepo.findAndCount).toHaveBeenCalledWith({
        where: { isDeleted: false },
      });
    });

    it('should inject isDeleted: false into existing where', async () => {
      await softDeleteRepo.findAndCount({ where: { id: 'x' } as any });
      expect(underlyingRepo.findAndCount).toHaveBeenCalledWith({
        where: { id: 'x', isDeleted: false },
      });
    });

    it('should handle array where clause', async () => {
      await softDeleteRepo.findAndCount({
        where: [{ id: 'a' } as any, { id: 'b' } as any],
      });
      expect(underlyingRepo.findAndCount).toHaveBeenCalledWith({
        where: [
          { id: 'a', isDeleted: false },
          { id: 'b', isDeleted: false },
        ],
      });
    });
  });

  // ------------------------------------------------------------------ //
  //  count                                                              //
  // ------------------------------------------------------------------ //

  describe('count', () => {
    it('should inject isDeleted: false when options is undefined', async () => {
      await softDeleteRepo.count();
      expect(underlyingRepo.count).toHaveBeenCalledWith({
        where: { isDeleted: false },
      });
    });

    it('should inject isDeleted: false into existing where', async () => {
      await softDeleteRepo.count({ where: { id: 'y' } as any });
      expect(underlyingRepo.count).toHaveBeenCalledWith({
        where: { id: 'y', isDeleted: false },
      });
    });
  });

  // ------------------------------------------------------------------ //
  //  Delegated methods                                                  //
  // ------------------------------------------------------------------ //

  describe('delegated methods', () => {
    it('should delegate manager', () => {
      expect(softDeleteRepo.manager).toBe(underlyingRepo.manager);
    });

    it('should delegate metadata', () => {
      expect(softDeleteRepo.metadata).toBe(underlyingRepo.metadata);
    });

    it('should delegate target', () => {
      expect(softDeleteRepo.target).toBe(underlyingRepo.target);
    });

    it('should delegate create', () => {
      const entity = { id: '1' };
      softDeleteRepo.create(entity);
      expect(underlyingRepo.create).toHaveBeenCalledWith(entity);
    });

    it('should delegate save', async () => {
      const entity = { id: '1' };
      await softDeleteRepo.save(entity);
      expect(underlyingRepo.save).toHaveBeenCalledWith(entity);
    });

    it('should delegate update', async () => {
      await softDeleteRepo.update({ id: '1' }, { status: 'Active' });
      expect(underlyingRepo.update).toHaveBeenCalledWith({ id: '1' }, { status: 'Active' });
    });

    it('should delegate remove', async () => {
      const entity = { id: '1' };
      await softDeleteRepo.remove(entity);
      expect(underlyingRepo.remove).toHaveBeenCalledWith(entity);
    });

    it('should delegate delete', async () => {
      await softDeleteRepo.delete({ id: '1' });
      expect(underlyingRepo.delete).toHaveBeenCalledWith({ id: '1' });
    });

    it('should delegate createQueryBuilder', () => {
      softDeleteRepo.createQueryBuilder('jobConfig');
      expect(underlyingRepo.createQueryBuilder).toHaveBeenCalledWith('jobConfig');
    });

    it('should delegate createQueryBuilder without alias', () => {
      softDeleteRepo.createQueryBuilder();
      expect(underlyingRepo.createQueryBuilder).toHaveBeenCalledWith(undefined);
    });

    it('should delegate query', async () => {
      await softDeleteRepo.query('SELECT 1', []);
      expect(underlyingRepo.query).toHaveBeenCalledWith('SELECT 1', []);
    });
  });
});
