import {
  Injectable,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import { Repository } from 'typeorm';
import hbs from 'nodemailer-express-handlebars';
import { NOTIFICATION_TYPE } from './dto/notification.type';

import { IncidentStatus, SyncEmail } from 'src/entities/sync-email.entity';
import { EmailContentStatus } from 'src/constants/email-content.enum';
import {
  LoggerFactory,
  LoggerService
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class EmailService {
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
  async setupAndSendMail(emailContent: any, notificationType: string) {
    try {
      await this.setupTransporter(emailContent, notificationType);
    } catch (error) {
      return { message: error.message, statusCode: 500 };
    }
    return { message: 'Email sent successfully', statusCode: 200 };
  }
  async setupTransporter(emailContent: any, notificationType: string) {
    try {
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
      this.logger.error(
        'Error setting up SMTP transporter and sending mail:',
        error.message,
      );
      throw new Error(
        `Error setting up SMTP transporter and sending mail: ${error.message}`,
      );
    }
  }

  async sendEmailForFailureEvents(emailContent: any, from: string, to: string) {
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
    } catch (error) {
      this.logger.error(`Error sending email: ${error.message}`);
      throw new Error(`Error sending email: ${error.message}`);
    } finally {
      if (emailContent.status === EmailContentStatus.FIRING) {
        await this.syncEmailRepo.save(syncEmail);
      } else {
        await this.syncEmailRepo.update(
          {
            incidentStatus: IncidentStatus.OPEN,
            alertSource: podName ?? instanceName,
            alertName: alertName,
          },
          { incidentStatus: IncidentStatus.CLOSED },
        );
      }
    }
  }

  async getSMTPSettings() {
    const smtpSettings: GlobalSettings[] = await this.settingsRepo.find({
      where: { settingType: SettingType.SMTP },
    });
    return smtpSettings;
  }

  async setupAndSendMailForSuccessEvents(
    emailContent: any,
    notificationType: string,
  ) {
    try {
      await this.setupTransporter(emailContent, notificationType);
    } catch (error) {
      return { message: error.message, statusCode: 500 };
    }
    return { message: 'Email sent successfully', statusCode: 200 };
  }

  async setupTemplateBasdOnNotificationType(templateName: string) {
    this.transporter.use(
      'compile',
      hbs({
        viewEngine: {
          extname: '.hbs',
          layoutsDir: path.join(__dirname, '../../templates/views'),
          defaultLayout: templateName,
        },
        viewPath: path.join(__dirname, '../../templates/views'),
        extName: '.hbs',
      }),
    );
  }
  async sendEmailForSuccessEvent(content: any, from: string, to: string) {
    const body = content?.body;
    const mailOptions = {
      from: from,
      to: to,
      subject: `DataMigrator Alert`,
      template: 'success',
      context: {
        body,
      },
    };
    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      this.logger.error(`Error sending email: ${error.message}`);
      throw new Error(`Error sending email: ${error.message}`);
    }
  }
}
