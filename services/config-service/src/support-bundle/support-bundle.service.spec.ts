import { Test, TestingModule } from '@nestjs/testing';
import { SupportBundleService } from './support-bundle.service';

describe('SupportBundleService', () => {
  let service: SupportBundleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SupportBundleService],
    }).compile();

    service = module.get<SupportBundleService>(SupportBundleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
