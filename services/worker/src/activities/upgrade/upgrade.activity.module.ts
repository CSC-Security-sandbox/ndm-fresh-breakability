/**
 * Upgrade Activity Module
 * 
 * NestJS module for upgrade-related activities.
 * Provides the platform-specific binary handler via factory pattern.
 */

import { Module } from '@nestjs/common';
import { HttpModule, HttpService } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '../../auth/auth.module';
import { AuthService } from '../../auth/auth.service';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { UpgradeActivityService } from './upgrade.activity.service';
import { LinuxBinaryHandler } from './handlers/linux-binary.handler';
import { WindowsBinaryHandler } from './handlers/windows-binary.handler';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    AuthModule,
  ],
  providers: [
    UpgradeActivityService,
    {
      provide: 'BINARY_HANDLER',
      useFactory: (
        httpService: HttpService,
        authService: AuthService,
        configService: ConfigService,
        loggerFactory: LoggerFactory,
      ) => {
        const logger = loggerFactory.create('BinaryHandler');
        return process.platform === 'win32'
          ? new WindowsBinaryHandler(httpService, authService, configService, logger)
          : new LinuxBinaryHandler(httpService, authService, configService, logger);
      },
      inject: [HttpService, AuthService, ConfigService, LoggerFactory],
    },
  ],
  exports: [UpgradeActivityService],
})
export class UpgradeActivityModule {}
