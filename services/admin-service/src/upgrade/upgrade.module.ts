import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkflowModule } from '../workflow/workflow.module';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';
import { WorkerEntity } from '../entities/worker.entity';
import { WorkerStatsEntity } from '../entities/worker-stats.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UpgradeBundle, WorkerEntity, WorkerStatsEntity, JobConfigEntity, JobRunEntity]),
    LoggerModule.forRoot(),
    ConfigModule,
    WorkflowModule,
    AuthKeycloakModule,
  ],
  controllers: [UpgradeController],
  providers: [UpgradeService],
  exports: [UpgradeService],
})
export class UpgradeModule {}
