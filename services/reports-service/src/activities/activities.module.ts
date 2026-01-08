import { Module } from '@nestjs/common';
import { GeneratorModule } from 'src/generator/generator.module';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { ConsolidatedReportService } from './consolidated-report/consolidated-report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportsEntity, JobRunEntity, InventoryEntity, FileServerEntity]),
    GeneratorModule,
    LoggerModule.forRoot()
  ],
  providers: [
    ActivitiesService,
    DiscoveryReportService,
    ConsolidatedReportService,
    ProjectIdCacheService,
  ],
  exports: [
    ActivitiesService,
    ConsolidatedReportService,
  ],
})
export class ActivitiesModule {}
