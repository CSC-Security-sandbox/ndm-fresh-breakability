import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from './config/config.module';
import { JobConfigModule } from './jobconfig/jobconfig.module';
import { JobRunModule } from './jobrun/jobrun.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkerModule } from './workers/workers.module';
import { WorkflowModule } from './workflow/workflow.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    // LoggerModule.forRoot(),
    EventEmitterModule.forRoot(),
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    JobConfigModule, WorkerModule, JobRunModule, TasksModule,WorkflowModule, RedisModule
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class AppModule {
  // configure(consumer: MiddlewareConsumer) {
  //   consumer
  //     .apply(RequestLoggerMiddleware)
  //     .forRoutes('*');
  // }
}
