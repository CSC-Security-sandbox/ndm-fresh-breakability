import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AsupController } from './asup.controller';
import { AsupService } from './asup.service';
import { AsupSettingsService } from './asup-settings.service';
import { AsupSchedulerService } from './asup-scheduler.service';
import { ProjectEntity } from '../entities/project.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobStatsSummaryMvEntity } from '../entities/job-stats-summary-mv.entity';
import { VolumeEntity } from '../entities/volume.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([
      ProjectEntity,
      JobConfigEntity,
      JobRunEntity,
      JobStatsSummaryMvEntity,
      VolumeEntity,
    ]),
  ],
  controllers: [AsupController],
  providers: [AsupService, AsupSettingsService, AsupSchedulerService],
  exports: [AsupService, AsupSettingsService, AsupSchedulerService],
})
export class AsupModule {}
