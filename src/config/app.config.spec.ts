import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService, ConfigModule } from '@nestjs/config';
import workerConfig, { WorkersConfig } from './app.config';


describe('WorkersConfig', () => {
  let workersConfig: WorkersConfig;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [workerConfig],
        }),
      ],
      providers: [ConfigService, WorkersConfig],
    }).compile();

    workersConfig = module.get<WorkersConfig>(WorkersConfig);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(workersConfig).toBeDefined();
  });

  it('should return correct value for worker configuration keys', () => {
    const mockKey = 'shutdownTimeout';
    const mockValue = 5000;
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      if (key === `worker.${mockKey}`) {
        return mockValue;
      }
      return null;
    });

    const result = WorkersConfig.get(mockKey);
    expect(result).toBe(mockValue);
  });
});
