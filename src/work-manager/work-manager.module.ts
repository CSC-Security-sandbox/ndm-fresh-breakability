import { Module } from '@nestjs/common';
import { WorkManagerController } from './work-manager.controller';
import { WorkManagerService } from './work-manager.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import appConfig from 'src/config/app.config';
import { WorkflowModule } from 'src/workflow/workflow.module';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [appConfig] }),
    TypeOrmModule.forFeature([WorkerEntity]),
    WorkflowModule,
    AuthKeycloakModule
  ],
  controllers: [WorkManagerController],
  providers: [WorkManagerService]
})
export class WorkManagerModule {}
