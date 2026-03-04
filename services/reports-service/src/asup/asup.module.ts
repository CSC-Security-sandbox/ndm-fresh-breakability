import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AsupController } from './asup.controller';
import { AsupSchedulerService } from './asup-scheduler.service';
import { AsupStatsService } from './asup-stats.service';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { AsupPackagerService } from './asup-packager.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [AsupController],
  providers: [
    AsupSchedulerService,
    AsupStatsService,
    AsupXmlGeneratorService,
    AsupPackagerService,
  ],
  exports: [
    AsupSchedulerService,
    AsupStatsService,
    AsupXmlGeneratorService,
    AsupPackagerService,
  ],
})
export class AsupModule {}
