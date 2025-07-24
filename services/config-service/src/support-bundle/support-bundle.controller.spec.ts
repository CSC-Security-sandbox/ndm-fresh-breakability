import { Test, TestingModule } from '@nestjs/testing';
import { SupportBundleController } from './support-bundle.controller';

describe('SupportBundleController', () => {
  let controller: SupportBundleController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportBundleController],
    }).compile();

    controller = module.get<SupportBundleController>(SupportBundleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
