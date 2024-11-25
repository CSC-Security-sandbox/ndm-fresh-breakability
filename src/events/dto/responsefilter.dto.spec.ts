import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {  Operations, ResponseStatus, TaskType } from 'src/constants/status';
import { Protocol } from 'src/constants/enums';
import { WorkerRequestDTO } from './responsefilter.dto';

describe('WorkerRequestDTO', () => {
  it('should succeed when all valid fields are provided', async () => {
    const validData: WorkerRequestDTO = {
      page: '1',
      limit: '10',
      sort: 'createdAt',
      order: 'asc',
      transactionId: '1234',
      status: ResponseStatus.PENDING,
      taskType: TaskType.LIST_PATHS,
      operation: Operations.LIST_NFS_PATHS,
      workerId: 'worker456',
    };

    const dto = plainToInstance(WorkerRequestDTO, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0);
  });

  it('should fail when page is not a number string', async () => {
    const invalidData = {
      page: 'abc',
    };

    const dto = plainToInstance(WorkerRequestDTO, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isNumberString');
  });

  it('should fail when limit is not a number string', async () => {
    const invalidData = {
      limit: 'xyz',
    };

    const dto = plainToInstance(WorkerRequestDTO, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isNumberString');
  });

  it('should fail when sort is not one of the allowed values', async () => {
    const invalidData = {
      sort: 'invalidField',
    };

    const dto = plainToInstance(WorkerRequestDTO, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should fail when order is not either "asc" or "desc"', async () => {
    const invalidData = {
      order: 'invalidOrder',
    };

    const dto = plainToInstance(WorkerRequestDTO, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should succeed when optional fields are not provided', async () => {
    const validData = {};

    const dto = plainToInstance(WorkerRequestDTO, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0); // Validation should pass
  });

  it('should correctly transform string to boolean for deserialize', async () => {
    const validData = {
      deserialize: 'true',
    };

    const dto = plainToInstance(WorkerRequestDTO, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0);

  });

  it('should correctly fail when requestId is not a string', async () => {
    const invalidData = {
      transactionId: 12345, 
    };

    const dto = plainToInstance(WorkerRequestDTO, invalidData);
    const errors = await validate(dto as any);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});
