import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InitUploadDto } from './upgrade.dto';

describe('InitUploadDto', () => {
  it('should validate a valid InitUploadDto', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.tar.gz',
      fileSize: 1024 * 1024 * 100,
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail validation for non-tar.gz file', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.zip',
      fileSize: 1024 * 1024,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('fileName');
  });

  it('should fail validation for missing fileName', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileSize: 1024 * 1024,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail validation for zero fileSize', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.tar.gz',
      fileSize: 0,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('fileSize');
  });

  it('should fail validation for negative fileSize', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.tar.gz',
      fileSize: -100,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail validation for file size exceeding maximum', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.tar.gz',
      fileSize: 25 * 1024 * 1024 * 1024, // 25GB exceeds 20GB max
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should accept file size at maximum limit', async () => {
    const dto = plainToInstance(InitUploadDto, {
      fileName: 'upgrade-v2.1.0.tar.gz',
      fileSize: 20 * 1024 * 1024 * 1024, // Exactly 20GB
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
