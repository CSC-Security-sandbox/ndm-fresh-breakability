import { Controller, Logger } from '@nestjs/common';
import { SchedularService } from './schedule.service';
import { Cron } from '@nestjs/schedule';

@Controller('schedular')
export class SchedularController {
  private readonly logger = new Logger(SchedularService.name);
  constructor(private readonly schedularService: SchedularService) {}

  @Cron('* * * * *')
  async handleCron(): Promise<string> {
    this.logger.log('Cron job executed at: ', new Date());
    return await this.schedularService.handleCron();
  }
}