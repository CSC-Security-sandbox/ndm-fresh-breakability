import { ConfigModule } from '@nestjs/config';
import appConfig, { WorkersConfig } from './config/app.config';
import commandConfig, { CommandConfig } from './config/command.config';
import temporalConfig from './config/temporal.config';
import { WorkManagerModule } from './work-manager/work-manager.module';
import { ActivitiesModule } from './activities/activities.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { AuthModule } from './auth/auth.module';
import { MetricsModule } from './metrics/metrics.module';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import {
  LoggerModule,
  RequestContextMiddleware,
} from '@netapp-cloud-datamigrate/logger-lib';
import { Protocols } from './protocols/protocols';
import { NFSProtocol } from "./protocols/nfs/nfs.protocol";
import { SMBProtocol } from "./protocols/smb/smb.protocol";

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [appConfig, commandConfig, temporalConfig] }),
    WorkManagerModule,
    ActivitiesModule,
    HealthcheckModule,
    AuthModule,
    MetricsModule,
  ],
  providers: [WorkersConfig, CommandConfig, Protocols, NFSProtocol, SMBProtocol],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
