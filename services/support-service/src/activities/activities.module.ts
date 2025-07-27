import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { ConfigService } from '@nestjs/config';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';

@Module({
  providers: [
    ActivitiesService,
    LogGeneratorActivity,
    NotifyConfigActivity,
    ConfigService,
  ],
  exports: [ActivitiesService, LogGeneratorActivity, NotifyConfigActivity],
})
export class ActivitiesModule {}
