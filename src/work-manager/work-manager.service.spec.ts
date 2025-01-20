import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerService } from './work-manager.service';

describe('WorkManagerService', () => {
  let service: WorkManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkManagerService],
    }).compile();

    service = module.get<WorkManagerService>(WorkManagerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
