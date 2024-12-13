import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { EventsModule } from './events/events.module';
import { JobConfigModule } from './jobconfig/jobconfig.module';
import { WorkerModule } from './workers/workers.module';
import { JobRunModule } from './jobrun/jobrun.module';

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
    JobConfigModule, EventsModule, WorkerModule, JobRunModule
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
