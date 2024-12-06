import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { EventsModule } from './events/events.module';
import { JobConfigModule } from './jobconfig/jobconfig.module';
import { WorkerModule } from './workers/workers.module';
import { JobRunModule } from './jobrun/jobrun.module';
import { JobMappingModule } from './jobmappings/jobmapping.module';
import { TaskModule } from './tasks/tasks.module';
import appConfig from './config/app.config';
import { RabbitmqModule } from './rabbitmq/rabbitmq.module';
import { AppConfigModule } from './config/config.module';
import { LoggerModule, RequestLoggerMiddleware } from '@netapp-cloud-datamigrate/logger-lib';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    // LoggerModule.forRoot(),
    EventEmitterModule.forRoot(),
    ConfigModule.forRoot({ load: [databaseConfig, appConfig], isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    JobConfigModule, EventsModule, WorkerModule, JobRunModule, JobMappingModule, TaskModule, RabbitmqModule, AppConfigModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {
  // configure(consumer: MiddlewareConsumer) {
  //   consumer
  //     .apply(RequestLoggerMiddleware)
  //     .forRoutes('*');
  // }
}
