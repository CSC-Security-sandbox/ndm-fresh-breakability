import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AsupController } from './asup.controller';
import { AsupSchedulerService } from './asup-scheduler.service';
import { AsupStatsService } from './asup-stats.service';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { AsupPackagerService } from './asup-packager.service';
import { SerialIdSyncService } from '../serial-id-sync.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [AsupController],
  providers: [
    AsupSchedulerService,
    AsupStatsService,
    AsupXmlGeneratorService,
    AsupPackagerService,
    SerialIdSyncService,
  ],
  exports: [
    AsupSchedulerService,
    AsupStatsService,
    AsupXmlGeneratorService,
    AsupPackagerService,
    SerialIdSyncService,
  ],
})
export class AsupModule {}
