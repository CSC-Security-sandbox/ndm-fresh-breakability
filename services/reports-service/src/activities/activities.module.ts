import { Module } from '@nestjs/common';
import { GeneratorModule } from 'src/generator/generator.module';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.serivce';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ReportsEntity, JobRunEntity]),
    GeneratorModule
  ],
  providers: [
    ActivitiesService,
    DiscoveryReportService,
  ],
  exports: [
    ActivitiesService
  ],
})
export class ActivitiesModule {}
