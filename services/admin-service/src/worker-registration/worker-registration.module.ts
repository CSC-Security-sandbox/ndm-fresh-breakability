import { Module } from '@nestjs/common';
import { WorkerRegistrationController } from './worker-registration.controller';
import { WorkerRegistrationService } from './worker-registration.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [AuthKeycloakModule, LoggerModule.forRoot()],
  controllers: [WorkerRegistrationController],
  providers: [WorkerRegistrationService],
})
export class WorkerRegistrationModule {}
