import { Module, Logger } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HealthcheckService } from './healthcheck.service';
import { HealthcheckProviders } from './healthcheck.providers';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    HealthcheckService,
    Logger,
    ConfigService,
    ...HealthcheckProviders,
  ],
  exports: [HealthcheckService],
})
export class HealthcheckModule {}
