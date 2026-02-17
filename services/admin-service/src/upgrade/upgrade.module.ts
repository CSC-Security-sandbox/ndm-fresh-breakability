import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkflowModule } from '../workflow/workflow.module';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { WorkerEntity } from '../entities/worker.entity';
import { WorkerStatsEntity } from '../entities/worker-stats.entity';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule,
    WorkflowModule,
    AuthKeycloakModule,
    TypeOrmModule.forFeature([WorkerEntity, WorkerStatsEntity]),
  ],
  controllers: [UpgradeController],
  providers: [UpgradeService],
  exports: [UpgradeService],
})
export class UpgradeModule {}
