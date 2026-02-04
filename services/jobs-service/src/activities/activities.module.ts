import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ListDirsActivity } from './list-dirs/list-dirs.activity';
import { RedisModule } from 'src/redis/redis.module';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot(), RedisModule],
  providers: [ActivitiesService, ListDirsActivity],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}