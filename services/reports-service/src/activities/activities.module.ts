import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.serivce';
import { GeneratorModule } from 'src/generator/generator.module';
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
