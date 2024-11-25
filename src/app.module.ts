import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { EventsModule } from './events/events.module';
import { JobConfigModule } from './jobconfig/jobconfig.module';
import { WorkerModule } from './workers/workers.module';
import { JobRunModule } from './jobrun/jobrun.module';
import { SchedularModule } from './schedular/schedule.module';
import { JobMappingModule } from './jobmappings/jobmapping.module';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [databaseConfig, appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    JobConfigModule, JobRunModule, SchedularModule, JobMappingModule, EventsModule, WorkerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
