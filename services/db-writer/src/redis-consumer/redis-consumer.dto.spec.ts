import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConsumerDto } from './redis-consumer.dto';

describe('ConsumerDto', () => {
  let consumerDto: ConsumerDto;

  beforeEach(() => {
    consumerDto = new ConsumerDto();
  });

  describe('validation', () => {
    it('should pass validation with valid jobRunId', async () => {
      const validData = {
        jobRunId: 'valid-job-run-id-123',
      };

      const dto = plainToInstance(ConsumerDto, validData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(validData.jobRunId);
    });

    it('should fail validation when jobRunId is missing', async () => {
      const invalidData = {};

      const dto = plainToInstance(ConsumerDto, invalidData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('jobRunId');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    it('should fail validation when jobRunId is not a string', async () => {
      const invalidData = {
        jobRunId: 123,
      };

      const dto = plainToInstance(ConsumerDto, invalidData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('jobRunId');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    it('should fail validation when jobRunId is null', async () => {
      const invalidData = {
        jobRunId: null,
      };

      const dto = plainToInstance(ConsumerDto, invalidData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('jobRunId');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    it('should fail validation when jobRunId is undefined', async () => {
      const invalidData = {
        jobRunId: undefined,
      };

      const dto = plainToInstance(ConsumerDto, invalidData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('jobRunId');
      expect(errors[0].constraints).toHaveProperty('isString');
    });

    

    it('should pass validation with UUID format jobRunId', async () => {
      const validData = {
        jobRunId: '550e8400-e29b-41d4-a716-446655440000',
      };

      const dto = plainToInstance(ConsumerDto, validData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(validData.jobRunId);
    });

    it('should pass validation with alphanumeric jobRunId', async () => {
      const validData = {
        jobRunId: 'job-run-abc123',
      };

      const dto = plainToInstance(ConsumerDto, validData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(validData.jobRunId);
    });
  });

  describe('instantiation', () => {
    it('should create an instance of ConsumerDto', () => {
      expect(consumerDto).toBeInstanceOf(ConsumerDto);
    });


    it('should allow setting jobRunId', () => {
      const testJobRunId = 'test-job-run-id';
      consumerDto.jobRunId = testJobRunId;
      expect(consumerDto.jobRunId).toBe(testJobRunId);
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in jobRunId', async () => {
      const validData = {
        jobRunId: 'job-run_123@test.com',
      };

      const dto = plainToInstance(ConsumerDto, validData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(validData.jobRunId);
    });

    it('should handle very long jobRunId strings', async () => {
      const validData = {
        jobRunId: 'a'.repeat(1000),
      };

      const dto = plainToInstance(ConsumerDto, validData);
      const errors = await validate(dto);

      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(validData.jobRunId);
    });

    it('should handle jobRunId with only whitespace', async () => {
      const invalidData = {
        jobRunId: '   ',
      };

      const dto = plainToInstance(ConsumerDto, invalidData);
      const errors = await validate(dto);

      // Note: IsString validator doesn't check for empty/whitespace strings by default
      // If you need to validate non-empty strings, consider adding @IsNotEmpty() decorator
      expect(errors).toHaveLength(0);
      expect(dto.jobRunId).toBe(invalidData.jobRunId);
    });
  });
});
