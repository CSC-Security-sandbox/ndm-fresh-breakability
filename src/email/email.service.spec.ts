import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import { NOTIFICATION_TYPE } from './dto/notification.type';
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));

const mockSettingsRepo = {
  find: jest.fn(),
};
describe('EmailService', () => {
  let transporterMock: any;
  let service: EmailService;
  let settingsRepo: Repository<GlobalSettings>;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: mockSettingsRepo,
        },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
    settingsRepo = module.get<Repository<GlobalSettings>>(getRepositoryToken(GlobalSettings));
  });
  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('setupAndSendMail', () => {
    it('should successfully setup transporter and send email', async () => {
      const emailContent = { alerts: [{ labels: { severity: 'high', pod: 'test-pod' }, annotations: { description: 'Test description', summary: 'Test summary' } }] };
      
      jest.spyOn(service, 'setupTransporter').mockResolvedValue(undefined);
      const result = await service.setupAndSendMail(emailContent, 'FAILURE');
      expect(result).toEqual({ message: 'Email sent successfully', statusCode: 200 });
    });
    it('should return error message if setupTransporter fails', async () => {
      const emailContent = { alerts: [] };
      jest.spyOn(service, 'setupTransporter').mockRejectedValue(new Error('Transporter setup failed'));
      const result = await service.setupAndSendMail(emailContent, 'FAILURE');
      expect(result).toEqual({ message: 'Transporter setup failed', statusCode: 500 });
    });
  });
  describe('setupTransporter', () => {
    it('should setup transporter successfully with valid SMTP settings', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST', settingValue: 'smtp.gmail.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT', settingValue: '587', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME', settingValue: 'user', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD', settingValue: 'pass', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
  
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(smtpSettings);
      const transporterMock = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn(),
        use: jest.fn(),
      };
      jest.spyOn(transporterMock, 'sendMail').mockResolvedValue({});
      const emailContent = { alerts: [] };
      jest.spyOn(service, 'setupTransporter').mockImplementation(() => transporterMock as any);
      jest.spyOn(transporterMock, 'verify').mockResolvedValue(true);
      jest.spyOn(transporterMock, 'sendMail').mockImplementation(() => Promise.resolve({}));
    });
    it('should throw an error if SMTP settings are missing', async () => {
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);
      await expect(service.setupTransporter({ alerts: [] },'SUCCESS')).rejects.toThrow(Error);
    });
    it('should throw an error if transporter setup fails', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST', settingValue: 'smtp.gmail.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT', settingValue: '587', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME', settingValue: 'user', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD', settingValue: 'pass', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(smtpSettings);
      const transporterMock = {
        verify: jest.fn().mockRejectedValue(new Error('Transporter setup failed')),
      };
      await expect(service.setupTransporter({ alerts: [] },'SUCCESS')).rejects.toThrow(Error);
    });
    it('should throw an error if SMTP_FROM_EMAIL is missing', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST', settingValue: 'smtp.gmail.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT', settingValue: '587', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME', settingValue: 'user', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD', settingValue: 'pass', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com', settingType: SettingType.SMTP, id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(smtpSettings);
      const transporterMock = {
        verify: jest.fn().mockResolvedValue(true),
      };
     // jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transporterMock as any);
      await expect(service.setupTransporter({ alerts: [] },'SUCCESS')).rejects.toThrow(Error);
    });
    it('should send email for success event', async () => {
      const emailContent = { body: 'Test body' };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';
      const mailOptions = {
        from: fromAddress,
        to: toAddress,
        subject: 'DataMigrator Alert',
        template: 'success',
        context: {
          body: emailContent.body,
        },
      };
      const transporterMock = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn(),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;
      jest.spyOn(service, 'setupTransporter').mockResolvedValue(transporterMock as any);
      const sendMailSpy = jest.fn();
      jest.spyOn(transporterMock, 'sendMail').mockResolvedValue({});
      await service.sendEmailForSuccessEvent(emailContent, fromAddress, toAddress);
      expect(transporterMock.sendMail).toHaveBeenCalledWith(mailOptions);
    });
    it('should throw an error when email sending fails', async () => {
      const emailContent = { body: 'Test body' };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';
  
      const errorMessage = 'SMTP connection failed';
  
      const transporterMock = {
        sendMail: jest.fn().mockRejectedValue(new Error(errorMessage)),
        verify: jest.fn().mockResolvedValue(true),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;
  
      await expect(
        service.sendEmailForSuccessEvent(emailContent, fromAddress, toAddress)
      ).rejects.toThrow(`Error sending email: ${errorMessage}`);
  
      expect(transporterMock.sendMail).toHaveBeenCalled();
    });
  });
  describe('sendEmailForFailureEvents', () => {
    let service: EmailService;
  
    beforeEach(() => {
      service = new EmailService({} as any); // Mock Repository
    });
  
    it('should send email for failure event successfully', async () => {
      const emailContent = {
        alerts: [
          {
            labels: { severity: 'critical', pod: 'pod-123' },
            annotations: { description: 'Service down', summary: 'Outage' },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';
  
      const mailOptions = {
        from: fromAddress,
        to: toAddress,
        subject: `DataMigrator Alert - Severity: critical`,
        template: 'failure',
        context: {
          severity: 'critical',
          podName: 'pod-123',
          description: 'Service down',
          summary: 'Outage',
        },
      };
  
      const transporterMock = {
        sendMail: jest.fn().mockResolvedValue({}),
        verify: jest.fn().mockResolvedValue(true),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;
  
      await service.sendEmailForFailureEvents(emailContent, fromAddress, toAddress);
  
      expect(transporterMock.sendMail).toHaveBeenCalledWith(mailOptions);
    });
  
    it('should throw an error when email sending fails', async () => {
      const emailContent = {
        alerts: [
          {
            labels: { severity: 'critical', pod: 'pod-123' },
            annotations: { description: 'Service down', summary: 'Outage' },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';
  
      const errorMessage = 'SMTP connection failed';
  
      const transporterMock = {
        sendMail: jest.fn().mockRejectedValue(new Error(errorMessage)), 
        verify: jest.fn().mockResolvedValue(true),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;
  
      await expect(
        service.sendEmailForFailureEvents(emailContent, fromAddress, toAddress)
      ).rejects.toThrow(`Error sending email: ${errorMessage}`);
  
      expect(transporterMock.sendMail).toHaveBeenCalled();
    });
  
    it('should handle missing alert data gracefully', async () => {
      const emailContent = { alerts: [{}] }; 
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';
  
      const mailOptions = {
        from: fromAddress,
        to: toAddress,
        subject: `DataMigrator Alert - Severity: unknown`,
        template: 'failure',
        context: {
          severity: 'unknown',
          podName: 'N/A',
          description: 'No description available.',
          summary: 'No summary available.',
        },
      };
  
      const transporterMock = {
        sendMail: jest.fn().mockResolvedValue({}),
        verify: jest.fn().mockResolvedValue(true),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;
      await service.sendEmailForFailureEvents(emailContent, fromAddress, toAddress);
      expect(transporterMock.sendMail).toHaveBeenCalledWith(mailOptions);
    });
  });
  
});