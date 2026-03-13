import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SuccessEventEmailDto } from './send-email.type';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class SendMailService {
  private readonly logger: LoggerService;
  readonly sendEmailUrl: string;
  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(SendMailService.name);
    this.sendEmailUrl = this.configService.get('app.email.sendMail');
  }

  async sendMail(body: SuccessEventEmailDto): Promise<unknown> {
    try {
      const sendEmailFullUrl = `${this.sendEmailUrl}/api/v1/email/internal`;

      // Only include headers if they exist
      const headers: Record<string, string> = {};
      if (body?.traceId) headers['trackId'] = body.traceId;
      if (body?.projectId) headers['projectId'] = body.projectId;

      const response = await axios.post(sendEmailFullUrl, body, { headers });
      if (response.status !== 200)
        throw new Error(
          `Failed to post the send mail request, ${response.data}`,
        );
      this.logger.log(`Succesfully sent the mail`, response.data as object);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send the mail: ${(error as Error).message}`);
    }
  }
}
