import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivitiesModule } from 'src/activities/activities.module';
import { AuthModule } from 'src/auth/auth.module';
import appConfig from 'src/config/app.config';
import keycloakConfig from 'src/config/keycloak.config';
import { WorkerOptionsService } from './factory/worker-options.factory.service';
import { WorkManagerService } from './work-manager.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [ 
    ConfigModule.forRoot({ load: [appConfig, keycloakConfig] }), 
    ScheduleModule.forRoot(), 
    HttpModule,
    LoggerModule.forRoot(),
    ActivitiesModule,
    AuthModule
  ],
  providers: [WorkManagerService, WorkerOptionsService]
})
export class WorkManagerModule {}
