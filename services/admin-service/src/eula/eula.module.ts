import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { EulaController } from './eula.controller';
import { EulaService } from './eula.service';
import { UserEulaStatus } from '../entities/user-eula-status.entity';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEulaStatus, UpgradeBundle]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [EulaController],
  providers: [EulaService],
  exports: [EulaService],
})
export class EulaModule {}
