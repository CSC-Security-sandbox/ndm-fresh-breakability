import { ConfigModule } from '@nestjs/config';
import appConfig, { WorkersConfig } from './config/app.config';
import commandConfig, { CommandConfig } from './config/command.config';
import temporalConfig from './config/temporal.config';
import { ActivitiesModule } from './activities/activities.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { AuthModule } from './auth/auth.module';
import { MetricsModule } from './metrics/metrics.module';
import { WorkerThreadModule } from './thread/worker.thread.module';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { Protocols } from './protocols/protocols';
import { NFSProtocol } from "./protocols/nfs/nfs.protocol";
import { SMBProtocol } from "./protocols/smb/smb.protocol";
import {
  LoggerModule,
  RequestContextMiddleware,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkManagerModule } from './work-manager/work-manager.module';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [appConfig, commandConfig, temporalConfig] }),
    ActivitiesModule,
    HealthcheckModule,
    ScheduleModule.forRoot(),
    AuthModule,
    MetricsModule,
    WorkManagerModule,
    WorkerThreadModule,
  ],
  providers: [WorkersConfig, CommandConfig, Protocols, NFSProtocol, SMBProtocol],
})

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}