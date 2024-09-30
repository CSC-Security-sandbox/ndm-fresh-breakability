import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RequestType, ResponseStatus } from 'src/constants/status';
import { Protocol } from 'src/constants/enums';
import { ResponsePageFilterDto } from './responcefilter.dto';

describe('ResponsePageFilterDto', () => {
  it('should succeed when all valid fields are provided', async () => {
    const validData: ResponsePageFilterDto = {
      page: '1',
      limit: '10',
      sort: 'createdAt',
      order: 'asc',
      requestType: RequestType.TestConnection,
      status: ResponseStatus.Pending,
      protocol: Protocol.NFS,
      requestId: 'req123',
      workerId: 'worker456',
    };

    const dto = plainToInstance(ResponsePageFilterDto, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0);
  });

  it('should fail when page is not a number string', async () => {
    const invalidData = {
      page: 'abc',
    };

    const dto = plainToInstance(ResponsePageFilterDto, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isNumberString');
  });

  it('should fail when limit is not a number string', async () => {
    const invalidData = {
      limit: 'xyz',
    };

    const dto = plainToInstance(ResponsePageFilterDto, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isNumberString');
  });

  it('should fail when sort is not one of the allowed values', async () => {
    const invalidData = {
      sort: 'invalidField',
    };

    const dto = plainToInstance(ResponsePageFilterDto, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should fail when order is not either "asc" or "desc"', async () => {
    const invalidData = {
      order: 'invalidOrder',
    };

    const dto = plainToInstance(ResponsePageFilterDto, invalidData);
    const errors = await validate(dto as any);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isIn');
  });

  it('should succeed when optional fields are not provided', async () => {
    const validData = {};

    const dto = plainToInstance(ResponsePageFilterDto, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0); // Validation should pass
  });

  it('should correctly transform string to boolean for deserialize', async () => {
    const validData = {
      deserialize: 'true',
    };

    const dto = plainToInstance(ResponsePageFilterDto, validData);
    const errors = await validate(dto as any);

    expect(errors.length).toBe(0);

  });

  it('should correctly fail when requestId is not a string', async () => {
    const invalidData = {
      requestId: 12345, 
    };

    const dto = plainToInstance(ResponsePageFilterDto, invalidData);
    const errors = await validate(dto as any);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});
