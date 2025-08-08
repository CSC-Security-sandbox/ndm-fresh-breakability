import { Module } from '@nestjs/common';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { RedisService } from './redis.service';

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [RedisService],
  exports:[RedisService]
})
export class RedisModule {}
