import { Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';
import appConfig, { WorkersConfig } from './config/app.config';
import commandConfig, { CommandConfig } from './config/command.config';
import temporalConfig from './config/temporal.config';
import { WorkManagerModule } from './work-manager/work-manager.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [appConfig, commandConfig, temporalConfig] }),
    WorkManagerModule
  ],
  providers: [WorkersConfig, CommandConfig],
})
export class AppModule {}
