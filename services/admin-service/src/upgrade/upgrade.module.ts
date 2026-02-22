import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { UpgradeBundle } from '../entities/upgrade-bundle.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UpgradeBundle, JobConfigEntity, JobRunEntity]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [UpgradeController],
  providers: [UpgradeService],
})
export class UpgradeModule {}