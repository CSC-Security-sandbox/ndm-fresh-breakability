import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.serivce';
@Module({
  imports: [
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
