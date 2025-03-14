import { EmailService } from './email.service';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import * as nodemailer from 'nodemailer';

// Create a fake settings repository
const fakeSettings: GlobalSettings[] = [
  { id: "1", settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: SettingType.SMTP },
  { id: "2", settingKey: 'SMTP_PORT', settingValue: '587', settingType: SettingType.SMTP },
  { id: "3", settingKey: 'SMTP_USER_NAME', settingValue: 'test@example.com', settingType: SettingType.SMTP },
  { id: "4", settingKey: 'SMTP_PASSWORD', settingValue: 'password123', settingType: SettingType.SMTP },
  { id: "5", settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com', settingType: SettingType.SMTP },
  { id: "6", settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com', settingType: SettingType.SMTP },
];

const fakeSettingsRepo = {
  find: jest.fn().mockResolvedValue(fakeSettings),
};

const fakeTransporter = {
  verify: jest.fn().mockResolvedValue(true),
  sendMail: jest.fn().mockResolvedValue({ messageId: '12345' }),
};

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => fakeTransporter),
}));

describe('EmailService', () => {
  let emailService: EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    emailService = new EmailService(fakeSettingsRepo as any);
  });

  describe('getSMTPSettings', () => {
    it('should return SMTP settings from the repository', async () => {
      const settings = await emailService.getSMTPSettings();
      expect(fakeSettingsRepo.find).toHaveBeenCalledWith({
        where: { settingType: SettingType.SMTP },
      });
      expect(settings).toEqual(fakeSettings);
    });
  });

  describe('setupTransporter', () => {
    const emailContent = { hello: 'world' };

    it('should create transporter, verify SMTP connection and send email', async () => {
      await emailService.setupTransporter(emailContent);
      
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: {
            user: 'test@example.com',
            pass: 'password123',
          },
          socketTimeout: 5000,
          connectionTimeout: 5000,
        })
      );

      expect(fakeTransporter.verify).toHaveBeenCalled();
      expect(fakeTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'from@example.com',
          to: 'to@example.com',
          subject: 'Data Migrator-Alert',
          text: JSON.stringify(emailContent),
        })
      );
    });

    it('should throw error if transporter.verify fails', async () => {
      fakeTransporter.verify.mockRejectedValueOnce(new Error('Verification failed'));
      await expect(emailService.setupTransporter(emailContent)).rejects.toThrow(
       
      );
    });
  });

  describe('sendEmail', () => {
    const emailContent = { data: 'test' };

    it('should send email successfully', async () => {
      emailService.transporter = fakeTransporter as any;

      await emailService.sendEmail(emailContent, 'from@example.com', 'to@example.com');
      expect(fakeTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'from@example.com',
          to: 'to@example.com',
          subject: 'Data Migrator-Alert',
          text: JSON.stringify(emailContent),
        })
      );
    });

    it('should throw an error if sendMail fails', async () => {
      fakeTransporter.sendMail.mockRejectedValueOnce(new Error('Send failure'));
      emailService.transporter = fakeTransporter as any;
      await expect(
        emailService.sendEmail(emailContent, 'from@example.com', 'to@example.com')
      ).rejects.toThrow('Error sending email');
    });
  });

  describe('setupAndSendMail', () => {
    const emailContent = { sample: 'data' };

    it('should return success response if email is sent successfully', async () => {
      const result = await emailService.setupAndSendMail(emailContent);
      expect(result).toEqual({ message: 'Email sent successfully', statusCode: 200 });
    });

    it('should return error response if setupTransporter fails', async () => {
      jest.spyOn(emailService, 'setupTransporter').mockRejectedValueOnce(new Error('SMTP error'));
      const result = await emailService.setupAndSendMail(emailContent);
      expect(result).toEqual({ message: 'SMTP error', statusCode: 500 });
    });
  });
});
