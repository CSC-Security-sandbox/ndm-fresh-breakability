import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class SendMailService {
  private readonly logger = new Logger(SendMailService.name);
  constructor(private readonly configService: ConfigService) {}

  async sendMail(body: any) {
    try {
      const SEND_MAIL = this.configService.get("app.email.sendMail");
      const response = await axios.post(`${SEND_MAIL}/api/v1/email/internal`, body);
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
