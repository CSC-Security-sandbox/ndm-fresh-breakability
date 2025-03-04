import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { EmailService } from './email.service';
import { ApiOperation } from '@nestjs/swagger';

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}
  @Post()
  @ApiOperation({
    summary: 'Send Email',
    description: 'Send Email',
  })
  create(@Body() emailContent: any) {
    return this.emailService.sendEmail(emailContent);
  }
}
