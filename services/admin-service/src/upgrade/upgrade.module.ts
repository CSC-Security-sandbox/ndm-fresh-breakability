import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkflowModule } from '../workflow/workflow.module';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';

@Module({
  imports: [
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
