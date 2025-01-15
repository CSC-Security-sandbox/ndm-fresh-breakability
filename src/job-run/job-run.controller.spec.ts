import { Test, TestingModule } from '@nestjs/testing';
import { JobRunController } from './job-run.controller';

describe('JobRunController', () => {
  let controller: JobRunController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JobRunController],
    }).compile();

    controller = module.get<JobRunController>(JobRunController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
