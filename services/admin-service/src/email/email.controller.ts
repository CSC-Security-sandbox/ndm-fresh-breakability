import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { EmailDto, SuccessEventEmailDto } from './dto/emailDto';
import { EmailService } from './email.service';
import { NOTIFICATION_TYPE } from './dto/notification.type';

@Controller('/api/v1/email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Auth()
  @ApiBearerAuth()
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

  @Auth()
  @ApiBearerAuth()
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
