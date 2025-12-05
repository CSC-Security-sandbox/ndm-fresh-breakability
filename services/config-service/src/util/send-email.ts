import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SuccessEventEmailDto } from './send-email.type';

@Injectable()
export class SendMailService {
  private readonly logger = new Logger(SendMailService.name);
  constructor(private readonly configService: ConfigService) {}

  async sendMail(body: SuccessEventEmailDto) {
    try {
      const SEND_MAIL = this.configService.get('app.email.sendMail');
      this.logger.log('SEND_MAIL', SEND_MAIL);
      const url = `${SEND_MAIL}/api/v1/email/internal`;
      this.logger.log('URL', url);

      // Only include headers if they exist
      const headers: any = {};
      if (body?.traceId) headers['trackId'] = body.traceId;
      if (body?.projectId) headers['projectId'] = body.projectId;

      const response = await axios.post(url, body, {
        timeout: 30000,
        headers
      });
      this.logger.log('RESPONSE', JSON.stringify(response.data));
      if (response.status !== 200) throw new Error(`Failed to send the mail, ${response.data}`);
      this.logger.log(`Successfully sent the mail`, response.data);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send the mail:`, error);
    }
  }
}
