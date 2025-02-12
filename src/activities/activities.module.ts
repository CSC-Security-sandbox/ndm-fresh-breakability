import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MyActivity } from './activity.service';
import { ValidateConnectionService } from './validate-connection/validate-connection';
import { ListPathActivity } from './list-path/list-path';
import { LoggerModule } from 'src/logger/logger.module';


@Module({
  imports: [HttpModule, LoggerModule],
  controllers: [],
  providers: [ValidateConnectionService, ListPathActivity],
  exports: [ ValidateConnectionService, ListPathActivity],
})
export class ActivitiesModule {}