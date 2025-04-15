import { Test, TestingModule } from '@nestjs/testing';
import { ErrorRemedyService } from './errorremedies.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorRemedyEntity } from '../entities/error-remedies.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';

const mockErrorRemedyRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
};

const mockOperationErrorRepo = {
  createQueryBuilder: jest.fn(() => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  })),
};

describe('ErrorRemedyService', () => {
  let service: ErrorRemedyService;
  let errorRemedyRepo: Repository<ErrorRemedyEntity>;
  let operationErrorRepo: Repository<OperationErrorEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorRemedyService,
        {
          provide: getRepositoryToken(ErrorRemedyEntity),
          useValue: mockErrorRemedyRepo,
        },
        {
          provide: getRepositoryToken(OperationErrorEntity),
          useValue: mockOperationErrorRepo,
        },
      ],
    }).compile();

    service = module.get<ErrorRemedyService>(ErrorRemedyService);
    errorRemedyRepo = module.get(getRepositoryToken(ErrorRemedyEntity));
    operationErrorRepo = module.get(getRepositoryToken(OperationErrorEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByErrorCodes', () => {
    it('should return remedies for the given error codes', async () => {
      const codes = ['TASK_FILE_NOT_FOUND', 'OP_PERMISSION_DENIED'];
      const remedies = [
        { errorCode: 'TASK_FILE_NOT_FOUND', description: 'desc1' },
        { errorCode: 'OP_PERMISSION_DENIED', description: 'desc2' },
      ];

      mockErrorRemedyRepo.find.mockResolvedValue(remedies);

      const result = await service.findByErrorCodes(codes);
      expect(result).toEqual(remedies);
      expect(mockErrorRemedyRepo.find).toHaveBeenCalledWith({
        where: { errorCode: expect.any(Object) },
      });
    });
  });

  describe('findByErrorCode', () => {
    it('should return remedy for a specific error code', async () => {
      const code = 'TASK_FILE_NOT_FOUND';
      const remedy = { errorCode: code, description: 'desc' };

      mockErrorRemedyRepo.findOne.mockResolvedValue(remedy);

      const result = await service.findByErrorCode(code);
      expect(result).toEqual(remedy);
      expect(mockErrorRemedyRepo.findOne).toHaveBeenCalledWith({
        where: { errorCode: code },
      });
    });

    it('should return undefined if remedy is not found', async () => {
      mockErrorRemedyRepo.findOne.mockResolvedValue(undefined);

      const result = await service.findByErrorCode('INVALID_CODE');
      expect(result).toBeUndefined();
    });
  });
});
