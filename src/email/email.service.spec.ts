import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { SettingType } from 'src/setting/dto/create-setting.dto';

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

      const result = await service.setupAndSendMail(emailContent);
      expect(result).toEqual({ message: 'Email sent successfully', statusCode: 200 });
    });

    it('should return error message if setupTransporter fails', async () => {
      const emailContent = { alerts: [] };
      jest.spyOn(service, 'setupTransporter').mockRejectedValue(new Error('Transporter setup failed'));

      const result = await service.setupAndSendMail(emailContent);
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
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transporterMock as any);
      jest.spyOn(transporterMock, 'sendMail').mockResolvedValue({});

      const emailContent = { alerts: [] };
      await service.setupTransporter(emailContent);

      expect(transporterMock.verify).toHaveBeenCalled();
      expect(transporterMock.sendMail).toHaveBeenCalled();
    });

    it('should throw an error if SMTP settings are missing', async () => {
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);

      await expect(service.setupTransporter({ alerts: [] })).rejects.toThrow(Error);
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
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transporterMock as any);

      await expect(service.setupTransporter({ alerts: [] })).rejects.toThrow(Error);
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
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transporterMock as any);

      await expect(service.setupTransporter({ alerts: [] })).rejects.toThrow(Error);
    });
  });

  describe('sendEmail', () => {
    it('should throw an error if sending email fails', async () => {
      const emailContent = { alerts: [] };
      const from = 'from@example.com';
      const to = 'to@example.com';

      const transporterMock = {
        sendMail: jest.fn().mockRejectedValue(new Error('Email sending failed')),
      };
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue(transporterMock as any);

      await expect(service.sendEmail(emailContent, from, to)).rejects.toThrow(Error);
    });
  });

  describe('getSMTPSettings', () => {
    it('should return SMTP settings', async () => {
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

      const result = await service.getSMTPSettings();
      expect(result).toEqual(smtpSettings);
    });

    it('should throw an error if retrieval fails', async () => {
      jest.spyOn(settingsRepo, 'find').mockRejectedValue(new Error('Database error'));

      await expect(service.getSMTPSettings()).rejects.toThrow(Error);
    });
  });
});
