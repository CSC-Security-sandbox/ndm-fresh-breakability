import { Module } from '@nestjs/common';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    AuthKeycloakModule,    // Enables @Auth() decorator to work
    LoggerModule.forRoot(), // Enables logging
  ],
  controllers: [UpgradeController],  // Register HTTP routes
  providers: [UpgradeService],       // Register injectable services
})
export class UpgradeModule {}