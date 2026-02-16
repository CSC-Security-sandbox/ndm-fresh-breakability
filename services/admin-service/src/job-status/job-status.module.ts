import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { JobConfig } from '../entities/job-config.entity';
import { JobRun } from '../entities/job-run.entity';
import { JobStatusController } from './job-status.controller';
import { JobStatusService } from './job-status.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobConfig, JobRun]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [JobStatusController],
  providers: [JobStatusService],
})
export class JobStatusModule {}
