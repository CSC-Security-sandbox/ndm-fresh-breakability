import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SuccessEventEmailDto } from './send-email.type';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class SendMailService {
  private logger: LoggerService;
  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(SendMailService.name);
  }

  async sendMail(body: SuccessEventEmailDto) {
    try {
      const SEND_MAIL = this.configService.get('app.email.sendMail');
      this.logger.log('SEND_MAIL', SEND_MAIL);
      const url = `${SEND_MAIL}/api/v1/email/internal`;
      this.logger.log('URL', url);
      const response = await axios.post(url, body, { timeout: 30000 });
      this.logger.log('RESPONSE', JSON.stringify(response));
      if (response.status !== 200)
        throw new Error(`Failed to send the mail, ${response.data}`);
      this.logger.log(`Successfully sent the mail`, response.data);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send the mail:`, error);
    }
  }
}
