import { Module } from '@nestjs/common';
import { JobModule } from './job/job.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from './events/events.module';
import { WorkerModule } from './workers/workers.module';
import { JobRunModule } from './job-run/jobrun.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    JobModule, EventsModule, WorkerModule, JobRunModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
