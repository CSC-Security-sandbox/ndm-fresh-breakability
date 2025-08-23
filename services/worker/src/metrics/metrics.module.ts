import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { MetricsService } from './metrics.service';

@Module({
  imports: [HttpModule, ConfigModule, LoggerModule.forRoot()],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
