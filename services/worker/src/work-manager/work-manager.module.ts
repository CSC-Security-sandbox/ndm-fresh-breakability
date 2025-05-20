import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivitiesModule } from 'src/activities/activities.module';
import { AuthModule } from 'src/auth/auth.module';
import appConfig from 'src/config/app.config';
import keycloakConfig from 'src/config/keycloak.config';
import { LoggerModule } from 'src/logger/logger.module';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { WorkManagerService } from './work-manager.service';


@Module({
  imports: [ 
    ConfigModule.forRoot({ load: [appConfig, keycloakConfig] }), 
    ScheduleModule.forRoot(), 
    HttpModule,
    LoggerModule,
    ActivitiesModule,
    AuthModule
  ],
  providers: [WorkManagerService, WorkerOptionsService]
})
export class WorkManagerModule {}
