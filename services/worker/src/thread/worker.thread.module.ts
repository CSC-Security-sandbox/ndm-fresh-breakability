import { Module } from '@nestjs/common';
import { WorkerThreadService } from './worker.thread.service';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { MetricsModule } from '../metrics/metrics.module';
import { AtimeReadSessionService } from './atime-read-session.service';

@Module({
  imports: [ConfigModule, LoggerModule.forRoot(), MetricsModule],
  providers: [WorkerThreadService, AtimeReadSessionService],
  exports: [WorkerThreadService, AtimeReadSessionService],
})
export class WorkerThreadModule {}
