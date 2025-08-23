import {
  Injectable,
  Inject,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import { Repository } from 'typeorm';
import hbsPlugin from 'nodemailer-express-handlebars';
import { NOTIFICATION_TYPE } from './dto/notification.type';

import { IncidentStatus, SyncEmail } from 'src/entities/sync-email.entity';
import { EmailContentStatus } from 'src/constants/email-content.enum';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger: LoggerService;
  transporter: nodemailer.Transporter;
  constructor(
    @InjectRepository(GlobalSettings)
    private settingsRepo: Repository<GlobalSettings>,
    @InjectRepository(SyncEmail)
    private syncEmailRepo: Repository<SyncEmail>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(EmailService.name);
  }

  async onModuleDestroy() {
    if (this.transporter) {
      try {
        this.transporter.close();
        this.logger.log('Email transporter closed successfully');
      } catch (error) {
        this.logger.error('Error closing email transporter', error);
      }
    }
  }

  private async closeTransporter() {
    if (this.transporter) {
      try {
        this.transporter.close();
        this.logger.debug('Transporter closed');
      } catch (error) {
        this.logger.error('Error closing transporter', error);
      }
    }
  }
  async setupAndSendMail(emailContent: any, notificationType: string) {
    try {
      await this.setupTransporter(emailContent, notificationType);
    } catch (error) {
      this.logger.error('Error setting up and sending email', error);
      // Ensure cleanup even if setup fails
      await this.closeTransporter();
      return { message: error.message, statusCode: 500 };
    }
    return { message: 'Email sent successfully', statusCode: 200 };
  }
  async setupTransporter(emailContent: any, notificationType: string) {
    try {
      // Close existing transporter if exists to prevent memory leaks
      await this.closeTransporter();

      const smtpSettings = await this.getSMTPSettings();
      const smtpConfig: any = {
        host: smtpSettings.find((setting) => setting.settingKey === 'SMTP_HOST')
          .settingValue,
        port: parseInt(
          smtpSettings.find((setting) => setting.settingKey === 'SMTP_PORT')
            .settingValue,
        ),
        secure: false,
      };

      if (
        smtpSettings.find((setting) => setting.settingKey === 'SMTP_USER_NAME')
          ?.settingValue &&
        smtpSettings.find((setting) => setting.settingKey === 'SMTP_PASSWORD')
          ?.settingValue
      ) {
        smtpConfig.auth = {
          user: smtpSettings.find(
            (setting) => setting.settingKey === 'SMTP_USER_NAME',
          )?.settingValue,
          pass: smtpSettings.find(
            (setting) => setting.settingKey === 'SMTP_PASSWORD',
          )?.settingValue,
        };
      }

      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth
          ? {
              user: smtpConfig.auth.user,
              pass: smtpConfig.auth.pass,
            }
          : undefined,
        socketTimeout: 5000,
        connectionTimeout: 5000,
        // Add connection pooling to prevent resource leaks
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
      });

      // Add error handling for transporter
      this.transporter.on('error', (error) => {
        this.logger.error('Transporter error:', error);
      });

      // Add idle event handler for cleanup
      this.transporter.on('idle', () => {
        this.logger.debug('Transporter is idle');
      });

      const templateName =
        notificationType === NOTIFICATION_TYPE.FAILURE ? 'failure' : 'success';
      this.setupTemplateBasdOnNotificationType(templateName);
      await this.transporter.verify();

      const fromAddress = smtpSettings.find(
        (setting) => setting.settingKey === 'SMTP_FROM_EMAIL',
      )?.settingValue;
      const toAddress = smtpSettings.find(
        (setting) => setting.settingKey === 'SMTP_TO_EMAIL',
      )?.settingValue;
      if (notificationType === NOTIFICATION_TYPE.FAILURE) {
        await this.sendEmailForFailureEvents(
          emailContent,
          fromAddress,
          toAddress,
        ); 
      } else {
        await this.sendEmailForSuccessEvent(
          emailContent,
          fromAddress,
          toAddress,
        );
      }
    } catch (error) {
      // Clean up transporter on error to prevent leaks
      await this.closeTransporter();

      this.logger.error(
        'Error setting up SMTP transporter and sending mail:',
        error.message,
      );
      throw new Error(
        `Error setting up SMTP transporter and sending mail: ${error.message}`,
      );
    } finally {
      // Always close transporter after use to prevent connection leaks
      await this.closeTransporter();
    }
  }

  async sendEmailForFailureEvents(emailContent: any, from: string, to: string) {
    try {
      const { alerts } = emailContent;
      const status = alerts[0]?.status || 'unknown';
      const isResolved = status === 'resolved';
      const severity = alerts[0]?.labels?.severity || 'unknown';
      const podName = alerts[0]?.labels?.pod || null;
      const instanceName = alerts[0]?.labels?.instance || null;
      const alertName = alerts[0]?.labels?.alertname || 'N/A';
      const description =
        alerts[0]?.annotations?.description || 'No description available.';
      const summary = alerts[0]?.annotations?.summary || 'No summary available.';

      this.logger.log('Sending failure notification email', {
        alertName,
        severity,
        podName: podName || instanceName
      });

      const mailOptions = {
        from: from,
        to: to,
        subject: `DataMigrator Alert - Severity: ${severity}`,
        template: 'failure',
        context: {
          isResolved,
          severity,
          podName,
          instanceName,
          description,
          summary,
        },
      };

      const syncEmail = new SyncEmail();
      syncEmail.mailContent = emailContent;
      syncEmail.incidentStatus = IncidentStatus.OPEN;
      syncEmail.description = description;
      syncEmail.summary = summary;
      syncEmail.alertSource = podName ?? instanceName;
      syncEmail.alertName = alertName;

      try {
        await this.transporter.sendMail(mailOptions);
        this.logger.log('Failure notification email sent successfully', { alertName });
      } catch (emailError) {
        this.logger.error('Error sending email', emailError);
        throw new Error(`Error sending email: ${emailError.message}`);
      }

      try {
        if (emailContent.status === EmailContentStatus.FIRING) {
          await this.syncEmailRepo.save(syncEmail);
          this.logger.log('Sync email record saved', { alertName });
        } else {
          await this.syncEmailRepo.update(
            {
              incidentStatus: IncidentStatus.OPEN,
              alertSource: podName ?? instanceName,
              alertName: alertName,
            },
            { incidentStatus: IncidentStatus.CLOSED },
          );
          this.logger.log('Sync email record updated to closed', { alertName });
        }
      } catch (dbError) {
        this.logger.error('Error updating sync email database record', dbError);
        // Don't throw here as the email was already sent successfully
      }
    } catch (error) {
      this.logger.error('Error in sendEmailForFailureEvents', error);
      throw error;
    }
  }

  async getSMTPSettings() {
    try {
      const smtpSettings: GlobalSettings[] = await this.settingsRepo.find({
        where: { settingType: SettingType.SMTP },
      });
      return smtpSettings;
    } catch (error) {
      this.logger.error('Error getting SMTP settings', error);
      throw new Error(`Error getting SMTP settings: ${error.message}`);
    }
  }

  async setupAndSendMailForSuccessEvents(
    emailContent: any,
    notificationType: string,
  ) {
    try {
      await this.setupTransporter(emailContent, notificationType);
    } catch (error) {
      this.logger.error('Error setting up and sending mail for success events', error);
      return { message: error.message, statusCode: 500 };
    }
    return { message: 'Email sent successfully', statusCode: 200 };
  }

  async setupTemplateBasdOnNotificationType(templateName: string) {
    try {
      this.logger.log('Setting up email template', { templateName });

      this.transporter.use(
        'compile',
        hbsPlugin({
          viewEngine: {
            extname: '.hbs',
            partialsDir: path.join(__dirname, '../../templates/partials'),
            layoutsDir: path.join(__dirname, '../../templates/views'),
            defaultLayout: templateName,
            helpers: {
              eq: (a, b) => a === b,
              join: (array, separator) => {
                if (Array.isArray(array)) return array.join(separator || ', ');
                return '';
              },
            },
          },
          viewPath: path.join(__dirname, '../../templates/views'),
          extName: '.hbs',
        })
      );

      this.logger.log('Email template setup completed', { templateName });
    } catch (error) {
      this.logger.error('Error setting up email template', error);
      throw new Error(`Error setting up email template: ${error.message}`);
    }
  }
  async sendEmailForSuccessEvent(content: any, from: string, to: string) {
    try {
      this.logger.log('Sending success notification email');
      const mailOptions = {
        from: from,
        to: to,
        subject: `DataMigrator Alert`,
        template: 'success',
        context: content
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log('Success notification email sent successfully');
    } catch (error) {
      this.logger.error('Error sending success email', error);
      throw new Error(`Error sending email: ${error.message}`);
    }
  }
}
