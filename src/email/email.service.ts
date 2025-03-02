import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  constructor() {}
  sendEmail(emailContent: any) {
    console.log(`Email Content:   ${emailContent}`);
    return { message: 'Email sent successfully', statusCode: 200 };
  }
}
