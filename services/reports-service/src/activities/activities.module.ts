import { Module } from '@nestjs/common';
import { GeneratorModule } from 'src/generator/generator.module';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { ProjectIdCacheService } from '../utils/project-id-cache.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportsEntity, JobRunEntity]),
    GeneratorModule,
    LoggerModule.forRoot()
  ],
  providers: [
    ActivitiesService,
    DiscoveryReportService,
    ProjectIdCacheService,
  ],
  exports: [
    ActivitiesService
  ],
})
export class ActivitiesModule {}
