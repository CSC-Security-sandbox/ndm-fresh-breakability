import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config.module';
import appConfig from './app.config';
import temporalConfig from './temporal.config';
import redisConfig from './redis.config';
import databaseConfig from './database.config';

describe('AppConfigModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();
  });

  it('should load the AppConfigModule with global configuration', async () => {
    const configModule = module.get<ConfigModule>(ConfigModule);

    expect(configModule).toBeDefined();
    expect(module).toBeDefined();
  });

  it('should load all configuration files', async () => {
    const configModule = module.get<ConfigModule>(ConfigModule);

    expect(configModule).toBeDefined();
    expect(appConfig).toBeDefined();
    expect(temporalConfig).toBeDefined();
    expect(redisConfig).toBeDefined();
    expect(databaseConfig).toBeDefined();
  });
});
