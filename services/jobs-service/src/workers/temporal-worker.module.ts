import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TemporalWorkerService } from './temporal-worker.service';
import { temporalWorkerProviders } from './temporal-worker.providers';
import { ActivitiesModule } from 'src/activities/activities.module';
import temporalConfig from 'src/config/temporal.config';

@Module({
  imports: [ConfigModule.forRoot({ load: [temporalConfig] }), ActivitiesModule],
  providers: [...temporalWorkerProviders, TemporalWorkerService],
})
export class TemporalWorkerModule {}