import { Module } from '@nestjs/common';
import { GeneratorModule } from 'src/generator/generator.module';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.serivce';

@Module({
  imports: [
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
