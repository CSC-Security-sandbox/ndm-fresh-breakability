import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MyActivity } from './activity.service';


@Module({
  imports: [HttpModule],
  controllers: [],
  providers: [MyActivity],
  exports: [MyActivity],
})
export class ActivitiesModule {}