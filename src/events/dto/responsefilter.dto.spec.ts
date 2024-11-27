import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { WorkerRequestDTO } from "./responsefilter.dto";

describe('WorkerRequestDTO - Branch Coverage', () => {
  it('should validate a valid DTO with all optional fields', async () => {
    const input = {
      page: '1',
      limit: '10',
      sort: 'createdAt',
      order: 'asc',
      taskType: 'VALIDATE_CONNECTION',
      status: 'PENDING',
      operation: 'VALIDATE_NFS_CONNECTION',
      transactionId: 'transaction123',
      workerId: 'worker123',
      deserialize: 'true',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should validate a DTO with minimal fields (optional fields omitted)', async () => {
    const input = {};

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0); 
  });

  it('should validate `deserialize` transformation for `true` and `false`', async () => {
    const trueInput = { deserialize: 'true' };
    const falseInput = { deserialize: 'false' };

    const trueDto = plainToInstance(WorkerRequestDTO, trueInput);
    const falseDto = plainToInstance(WorkerRequestDTO, falseInput);

    expect(trueDto.deserialize).toBe(true);
    expect(falseDto.deserialize).toBe(false);
  });

  it('should validate `deserialize` with no transformation', async () => {
    const input = { deserialize: true };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.deserialize).toBe(true);
  });

  it('should fail validation for invalid enum values', async () => {
    const input = {
      taskType: 'INVALID_TASK',
      status: 'INVALID_STATUS',
      operation: 'INVALID_OPERATION',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(3);
    expect(errors.map((err) => err.property)).toEqual(['taskType', 'status', 'operation']);
  });

  it('should validate with only `page` and `limit` fields', async () => {
    const input = {
      page: '2',
      limit: '5',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe('2');
    expect(dto.limit).toBe('5');
  });

  it('should fail validation for invalid `page` and `limit`', async () => {
    const input = {
      page: '-1',
      limit: 'notANumber',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('limit');
  });

  it('should validate `sort` and `order` with valid values', async () => {
    const input = {
      sort: 'workerId',
      order: 'desc',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.sort).toBe('workerId');
    expect(dto.order).toBe('desc');
  });

  it('should fail validation for invalid `sort` and `order` values', async () => {
    const input = {
      sort: 'invalidSort',
      order: 'invalidOrder',
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
    expect(errors[0].property).toBe('sort');
    expect(errors[1].property).toBe('order');
  });

  it('should fail validation for invalid `transactionId` and `workerId`', async () => {
    const input = {
      transactionId: 123, 
      workerId: false,    
    };

    const dto = plainToInstance(WorkerRequestDTO, input);
    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
    expect(errors.map((err) => err.property)).toEqual(['transactionId', 'workerId']);
  });
});
