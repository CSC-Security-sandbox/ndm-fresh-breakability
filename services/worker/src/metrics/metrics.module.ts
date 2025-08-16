import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [HttpModule, LoggerModule.forRoot()],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
