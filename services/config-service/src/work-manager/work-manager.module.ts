import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from 'src/config/app.config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkflowModule } from 'src/workflow/workflow.module';
import { WorkerEntity } from 'src/entities/worker.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { WorkManagerController } from './work-manager.controller';
import { WorkManagerService } from './work-manager.service';
import { SendMailService } from 'src/util/send-email';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { IngestJobRunConfig } from 'src/entities/ingest-jobrun-config.entity';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [appConfig] }),
    TypeOrmModule.forFeature([WorkerEntity, JobRunEntity, ConfigEntity, WorkerJobRunMap, IngestJobRunConfig]),
    WorkflowModule,
    AuthKeycloakModule
  ],
  controllers: [WorkManagerController],
  providers: [WorkManagerService,SendMailService]
})
export class WorkManagerModule {}
