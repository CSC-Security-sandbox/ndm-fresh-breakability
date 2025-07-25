import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { LogGeneratorService } from './log-generator/log-generator.service';
import { ConfigService } from '@nestjs/config';

@Module({
  providers: [ActivitiesService, LogGeneratorService, ConfigService],
  exports: [ActivitiesService, LogGeneratorService],
})
export class ActivitiesModule {}
