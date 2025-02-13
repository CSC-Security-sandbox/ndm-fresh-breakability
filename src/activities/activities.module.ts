import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ValidateConnectionActivity } from './validate-connection/validate-connection.service';
import { ListPathActivity } from './list-path/list-path.service';
import { LoggerModule } from 'src/logger/logger.module';
import { ConfigModule } from '@nestjs/config';


@Module({
  imports: [HttpModule, LoggerModule, ConfigModule],
  controllers: [],
  providers: [ValidateConnectionActivity, ListPathActivity],
  exports: [ ValidateConnectionActivity, ListPathActivity],
})
export class ActivitiesModule {}