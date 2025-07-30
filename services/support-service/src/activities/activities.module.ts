import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesService } from './activities.service';
import { LogGeneratorActivity } from './log-generator/log-generator.activity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotifyConfigActivity } from './notify-config/notify-config.activity';
import appConfig from 'src/config/app.config';
import temporalConfig from 'src/config/temporal.config';
import { ProjectEntity } from 'src/entities/project.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import databaseConfig from 'src/config/database.config';
import { ErrorCsvGenerationActivity } from './error-csv-generation/error-csv-generation.activity';
import { OperationErrorService } from 'src/utils/error-csv-generation.service';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ConfigEntity,
      FileServerEntity,
      VolumeEntity,
      JobConfigEntity,
      OperationErrorEntity,
      WorkerEntity,
      WorkerJobRunMap,
      WorkerStatsEntity,
    ]),
    ConfigModule.forRoot({ load: [appConfig, databaseConfig, temporalConfig] }),
  ],
  providers: [
    ActivitiesService,
    LogGeneratorActivity,
    NotifyConfigActivity,
    ErrorCsvGenerationActivity,
    ConfigService,
    OperationErrorService,
  ],
  exports: [
    ActivitiesService,
    LogGeneratorActivity,
    NotifyConfigActivity,
    ErrorCsvGenerationActivity,
    OperationErrorService,
  ],
})
export class ActivitiesModule {}
