import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import temporalConfig from './temporal.config';
import redisConfig from './redis.config';
import databaseConfig from './database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, temporalConfig, redisConfig, databaseConfig],
    }),
  ],
})
export class AppConfigModule {}
