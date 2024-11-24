import { Module } from '@nestjs/common';
import { JobConfigModule } from './jobconfig/jobconfig.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventsModule } from './events/events.module';
import { WorkerModule } from './workers/workers.module';
import { JobRunModule } from './jobrun/jobrun.module';
import { SchedularModule } from './schedular/schedule.module';
import { JobMappingModule } from './jobmappings/jobmapping.module';
import { TaskModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    JobConfigModule, EventsModule, WorkerModule, JobRunModule, SchedularModule, JobMappingModule, TaskModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
