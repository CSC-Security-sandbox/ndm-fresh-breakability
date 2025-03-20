import { Module } from '@nestjs/common';
import { WorkerRegistrationController } from './worker-registration.controller';
import { WorkerRegistrationService } from './worker-registration.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports:[AuthKeycloakModule],
  controllers: [WorkerRegistrationController],
  providers: [WorkerRegistrationService]
})
export class WorkerRegistrationModule {}
