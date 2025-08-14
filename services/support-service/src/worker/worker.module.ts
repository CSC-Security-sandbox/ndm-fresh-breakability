import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { workerProviders } from './worker.providers';
import { ActivitiesModule } from 'src/activities/activities.module';
import { ConfigModule } from '@nestjs/config';
import temporalConfig from 'src/config/temporal.config';

@Module({
  imports: [ConfigModule.forRoot({ load: [temporalConfig] }), ActivitiesModule],
  providers: [...workerProviders, WorkerService],
})
export class WorkerModule {}
