import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from 'src/entities/project.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { StorageOverviewSummaryEntity } from 'src/entities/storage-summary-mv.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryEntity,ProjectEntity,StorageOverviewSummaryEntity]), AuthKeycloakModule, LoggerModule.forRoot()],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
