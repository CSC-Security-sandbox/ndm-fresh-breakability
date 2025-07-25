import { Module } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';
import { ActivitiesModule } from './activities/activities.module';
import { ConfigModule } from '@nestjs/config';
import temporalConfig from './config/temporal.config';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [temporalConfig] }),
    WorkerModule,
    ActivitiesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
