import { Module } from '@nestjs/common';
import { WorkManagerService } from './work-manager.service';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import appConfig from 'src/config/app.config';
import { LoggerModule } from 'src/logger/logger.module';
import keycloakConfig from 'src/config/keycloak.config';


@Module({
  imports: [ 
    ConfigModule.forRoot({ load: [appConfig, keycloakConfig] }), 
    ScheduleModule.forRoot(), 
    HttpModule,
    LoggerModule
  ],
  providers: [WorkManagerService]
})
export class WorkManagerModule {}
