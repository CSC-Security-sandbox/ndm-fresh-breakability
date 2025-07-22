import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthcheckService } from './healthcheck.service';
import { HealthcheckProviders } from './healthcheck.providers';
import { AuthModule } from 'src/auth/auth.module';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [HttpModule, ConfigModule, AuthModule, LoggerModule.forRoot()],
  providers: [
    HealthcheckService,
    ConfigService,
    ...HealthcheckProviders,
  ],
  exports: [HealthcheckService],
})
export class HealthcheckModule {}
