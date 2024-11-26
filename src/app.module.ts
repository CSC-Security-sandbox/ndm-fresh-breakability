import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { EventsModule } from './events/events.module';
import { JobModule } from './job/job.module';
import { WorkerModule } from './workers/workers.module';
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
    JobModule, EventsModule, WorkerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
