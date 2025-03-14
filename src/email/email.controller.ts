import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EmailService } from './email.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import  {EmailDto} from './dto/emailDto';

@Controller('/api/v1/email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}
  @Post()
  @ApiOperation({
    summary: 'Send Email',
    description: 'Send Email',
  })
  @ApiBody({ type:  EmailDto })
  @ApiTags('Email')
  create(@Body() emailContent: EmailDto) {
    return this.emailService.setupAndSendMail(emailContent);
  }
}
