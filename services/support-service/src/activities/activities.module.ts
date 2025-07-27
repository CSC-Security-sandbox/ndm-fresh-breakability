import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { ConfigService } from '@nestjs/config';

@Module({
  providers: [ActivitiesService, LogGeneratorActivity, ConfigService],
  exports: [ActivitiesService, LogGeneratorActivity],
})
export class ActivitiesModule {}
