import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import {
  LoggerModule
} from '@netapp-cloud-datamigrate/logger-lib';


@Module({
  imports: [LoggerModule.forRoot()],
  providers: [RedisService],
  exports: [RedisService]
})
export class RedisModule { }
