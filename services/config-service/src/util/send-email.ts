import { ConsoleLogger, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SendMailService {
  private readonly logger = new Logger(SendMailService.name);
  constructor(private readonly configService: ConfigService) {}

  async sendMail(body: any) {
    try {
      const SEND_MAIL = this.configService.get('app.email.sendMail');
      console.log('SEND_MAL', SEND_MAIL);
      const url = `${SEND_MAIL}/api/v1/email/internal`;
      console.log('URL', url);
      const response = await axios.post(url, body);
      console.log('RESPONSE', response);
      if (response.status !== 200)
        throw new Error(`Failed to send the mail, ${response.data}`);
      this.logger.log(`Succesfully sent the mail`, response.data);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send the mail:`, error);
    }
  }
}
