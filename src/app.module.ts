import { Module } from '@nestjs/common';
import { LoggerService } from './logger/logger.service';
import { LoggerModule } from './logger/logger.module';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import temporalConfig from './config/temporal.config';
import commandConfig from './config/command.config';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { WorkManagerModule } from './work-manager/work-manager.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [appConfig, commandConfig, temporalConfig] }),
    LoggerModule,
    WorkManagerModule
  ],
  providers: [],
})
export class AppModule {}
