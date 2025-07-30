import { Injectable, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import axios from "axios";
import { SuccessEventEmailDto } from "./send-email.type";

@Injectable()
export class SendMailService {
  private readonly logger: LoggerService;
  readonly sendEmailUrl: string;
  constructor(
    @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
    private readonly configService: ConfigService
  ) {
    this.sendEmailUrl = this.configService.get("app.email.sendMail");
    this.logger = loggerFactory.create(SendMailService.name);
  }

  async sendMail(body: SuccessEventEmailDto) {
    try {
      const sendEmailFullUrl = `${this.sendEmailUrl}/api/v1/email/internal`;
      const response = await axios.post(sendEmailFullUrl, body);
      if (response.status !== 200)
        throw new Error(
          `Failed to post the send mail request, ${response.data}`
        );
      this.logger.log(`Succesfully sent the mail`, response.data);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send the mail:`, error);
    }
  }
}
