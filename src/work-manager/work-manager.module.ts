import { Module } from '@nestjs/common';
import { WorkManagerService } from './work-manager.service';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import appConfig from 'src/config/app.config';


@Module({
  imports: [ 
    ConfigModule.forRoot({ load: [appConfig] }), 
    ScheduleModule.forRoot(), 
    HttpModule,
  ],
  providers: [WorkManagerService]
})
export class WorkManagerModule {}
