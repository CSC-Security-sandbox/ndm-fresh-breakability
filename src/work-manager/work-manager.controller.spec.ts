import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerController } from './work-manager.controller';

describe('WorkManagerController', () => {
  let controller: WorkManagerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkManagerController],
    }).compile();

    controller = module.get<WorkManagerController>(WorkManagerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
