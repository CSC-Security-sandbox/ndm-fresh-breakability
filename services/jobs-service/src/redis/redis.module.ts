import { Module } from '@nestjs/common';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from './redis.service';

@Module({
  imports: [LoggerModule.forRoot(), AuthModule],
  providers: [RedisService],
  exports:[RedisService]
})
export class RedisModule {}
