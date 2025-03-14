import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import { text } from 'stream/consumers';
import { Repository } from 'typeorm';

@Injectable()
export class EmailService {
   transporter: nodemailer.Transporter;
  emailService: { verify: jest.Mock<any, any, any>; sendMail: jest.Mock<any, any, any>; };
  constructor(
    @InjectRepository(GlobalSettings)
    private settingsRepo: Repository<GlobalSettings>,
  ) {}
  async setupAndSendMail(emailContent: any) {
    try{
    await this.setupTransporter(emailContent);
    }catch(error){
      return { message: error.message, statusCode: 500 };
    }
    return { message: 'Email sent successfully', statusCode: 200 };
  }
  async setupTransporter(emailContent: any) {
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

      await this.transporter.verify();
      const fromAddress = smtpSettings.find(
        (setting) => setting.settingKey === 'SMTP_FROM_EMAIL',
      )?.settingValue;
      const toAddress = smtpSettings.find(
        (setting) => setting.settingKey === 'SMTP_TO_EMAIL',
      )?.settingValue;

      await this.sendEmail(emailContent, fromAddress, toAddress);
    } catch (error) {
      console.error('Error setting up SMTP transporter and sending mail:', error.message);
      throw new Error(`Error setting up SMTP transporter and sending mail: ${error.message}`);
    }
  }
  
  async sendEmail(emailContent: any, from: string, to: string) {
    const mailOptions = {
      from: from,
      to: to,
      subject: 'Data Migrator-Alert', // TODO: Needs to be discussed
      text: JSON.stringify(emailContent),
    };
    try {
      const info = await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error.message);
      throw new Error(`Error sending email: ${error.message}`);
    }
  }
  
  async getSMTPSettings() {
    const smtpSettings: GlobalSettings[] = await this.settingsRepo.find({
      where: { settingType: SettingType.SMTP },
    });
    return smtpSettings;
  }
}
