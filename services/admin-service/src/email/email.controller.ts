import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmailDto, SuccessEventEmailDto } from './dto/emailDto';
import { EmailService } from './email.service';
import { NOTIFICATION_TYPE } from './dto/notification.type';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@Controller('/api/v1/email')
export class EmailController {
  private logger: LoggerService;
  constructor(
    private readonly emailService: EmailService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(EmailController.name);
  }
  @Post('/external')
  @ApiOperation({
    summary: 'Send Email Notification',
    description:
      'Sends an email notification, primarily used for alerting failures or important system events.',
  })
  @ApiBody({ type: EmailDto })
  @ApiTags('Email')
  create(@Body() emailContent: EmailDto) {
    return this.emailService.setupAndSendMail(
      emailContent,
      NOTIFICATION_TYPE.FAILURE,
    );
  }

  @Post('/internal')
  @ApiOperation({
    summary: 'Send Email Notification',
    description:
      'Sends an email notification for successful events, confirming completion or status updates',
  })
  @ApiTags('Email')
  createInternal(@Body() content: SuccessEventEmailDto) {
    return this.emailService.setupAndSendMailForSuccessEvents(
      content,
      NOTIFICATION_TYPE.SUCCESS,
    );
  }
}
