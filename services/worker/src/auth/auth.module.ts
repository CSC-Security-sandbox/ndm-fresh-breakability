import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from 'src/config/app.config';
import keycloakConfig from 'src/config/keycloak.config';
import { AuthService } from './auth.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [ 
    ConfigModule.forRoot({ load: [appConfig, keycloakConfig] }),
    HttpModule,
    LoggerModule.forRoot(),
  ],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
