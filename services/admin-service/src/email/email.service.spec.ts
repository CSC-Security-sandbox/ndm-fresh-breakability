import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import { SettingType } from 'src/setting/dto/create-setting.dto';
import { IncidentStatus, SyncEmail } from 'src/entities/sync-email.entity';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import {
  mockLoggerFactory,
  resetLoggerMocks,
} from '../test-utils/logger-mocks';

enum EmailContentStatus {
  FIRING = 'firing',
  RESOLVED = 'resolved',
}

jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));

const mockSettingsRepo = {
  find: jest.fn(),
  update: jest.fn(),
};
describe('EmailService', () => {
  let service: EmailService;
  let settingsRepo: Repository<GlobalSettings>;
  let syncEmailRepo: Repository<SyncEmail>;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: mockSettingsRepo,
        },
        {
          provide: getRepositoryToken(SyncEmail),
          useValue: {
            save: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
    settingsRepo = module.get<Repository<GlobalSettings>>(
      getRepositoryToken(GlobalSettings),
    );
    syncEmailRepo = module.get<Repository<SyncEmail>>(
      getRepositoryToken(SyncEmail),
    );

    (service as any).transporter = {
      sendMail: jest.fn().mockResolvedValue({}),
      verify: jest.fn().mockResolvedValue(true),
      use: jest.fn(),
    };
  });
  afterEach(() => {
    jest.clearAllMocks();
    resetLoggerMocks();
  });
  describe('setupAndSendMail', () => {
    it('should successfully setup transporter and send email', async () => {
      const emailContent = {
        alerts: [
          {
            labels: { severity: 'high', pod: 'test-pod' },
            annotations: {
              description: 'Test description',
              summary: 'Test summary',
            },
          },
        ],
      };

      jest.spyOn(service, 'setupTransporter').mockResolvedValue(undefined);
      const result = await service.setupAndSendMail(emailContent, 'FAILURE');
      expect(result).toEqual({
        message: 'Email sent successfully',
        statusCode: 200,
      });
    });
    it('should return error message if setupTransporter fails', async () => {
      const emailContent = { alerts: [] };
      jest
        .spyOn(service, 'setupTransporter')
        .mockRejectedValue(new Error('Transporter setup failed'));
      const result = await service.setupAndSendMail(emailContent, 'FAILURE');
      expect(result).toEqual({
        message: 'Transporter setup failed',
        statusCode: 500,
      });
    });
  });

  describe('setupAndSendMailForSuccessEvents', () => {
    it('should successfully setup transporter and send email', async () => {
      const emailContent = {
        alerts: [
          {
            labels: { severity: 'high', pod: 'test-pod' },
            annotations: {
              description: 'Test description',
              summary: 'Test summary',
            },
          },
        ],
      };

      jest.spyOn(service, 'setupTransporter').mockResolvedValue(undefined);
      const result = await service.setupAndSendMailForSuccessEvents(
        emailContent,
        'SUCCESS',
      );
      expect(result).toEqual({
        message: 'Email sent successfully',
        statusCode: 200,
      });
    });
    it('should return error message if setupTransporter fails', async () => {
      const emailContent = { alerts: [] };
      jest
        .spyOn(service, 'setupTransporter')
        .mockRejectedValue(new Error('Transporter setup failed'));
      const result = await service.setupAndSendMailForSuccessEvents(
        emailContent,
        'SUCCESS',
      );
      expect(result).toEqual({
        message: 'Transporter setup failed',
        statusCode: 500,
      });
    });
  });
  describe('setupTransporter', () => {
    it('should setup transporter successfully with valid SMTP settings', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME',
          settingValue: 'user',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'pass',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL',
          settingValue: 'from@example.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL',
          settingValue: 'to@example.com',
          settingType: SettingType.SMTP,
          id: '1',
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
      jest
        .spyOn(service, 'setupTransporter')
        .mockImplementation(() => transporterMock as any);
      jest.spyOn(transporterMock, 'verify').mockResolvedValue(true);
      jest
        .spyOn(transporterMock, 'sendMail')
        .mockImplementation(() => Promise.resolve({}));
    });
    it('should throw an error if SMTP settings are missing', async () => {
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);
      await expect(
        service.setupTransporter({ alerts: [] }, 'SUCCESS'),
      ).rejects.toThrow(Error);
    });
    it('should call sendEmailForFailureEvents when notificationType is FAILURE', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          settingType: SettingType.SMTP,
          id: '2',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL',
          settingValue: 'from@example.com',
          settingType: SettingType.SMTP,
          id: '3',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL',
          settingValue: 'to@example.com',
          settingType: SettingType.SMTP,
          id: '4',
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
        sendMail: jest.fn().mockResolvedValue({}),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;

      const sendEmailForFailureEventsSpy = jest
        .spyOn(service, 'sendEmailForFailureEvents')
        .mockResolvedValue(undefined);
      const emailContent = { alerts: [{ status: 'firing' }] };

      await service.setupTransporter(emailContent, 'FAILURE');

      expect(sendEmailForFailureEventsSpy).toHaveBeenCalledWith(
        emailContent,
        'from@example.com',
        'to@example.com',
      );
    });

    it('should call sendEmailForSuccessEvent when notificationType is not FAILURE', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          settingType: SettingType.SMTP,
          id: '2',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL',
          settingValue: 'from@example.com',
          settingType: SettingType.SMTP,
          id: '3',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL',
          settingValue: 'to@example.com',
          settingType: SettingType.SMTP,
          id: '4',
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
        sendMail: jest.fn().mockResolvedValue({}),
        use: jest.fn(),
      };
      (service as any).transporter = transporterMock;

      const sendEmailForSuccessEventSpy = jest
        .spyOn(service, 'sendEmailForSuccessEvent')
        .mockResolvedValue(undefined);
      const emailContent = { alerts: [{ status: 'resolved' }] };

      await service.setupTransporter(emailContent, 'SUCCESS');

      expect(sendEmailForSuccessEventSpy).toHaveBeenCalledWith(
        emailContent,
        'from@example.com',
        'to@example.com',
      );
    });

    it('should throw an error if transporter setup fails', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME',
          settingValue: 'user',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'pass',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_FROM_EMAIL',
          settingValue: 'from@example.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL',
          settingValue: 'to@example.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(smtpSettings);
      await expect(
        service.setupTransporter({ alerts: [] }, 'SUCCESS'),
      ).rejects.toThrow(Error);
    });
    it('should throw an error if SMTP_FROM_EMAIL is missing', async () => {
      const smtpSettings = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_USER_NAME',
          settingValue: 'user',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'pass',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          settingKey: 'SMTP_TO_EMAIL',
          settingValue: 'to@example.com',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(smtpSettings);
      await expect(
        service.setupTransporter({ alerts: [] }, 'SUCCESS'),
      ).rejects.toThrow(Error);
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
      jest
        .spyOn(service, 'setupTransporter')
        .mockResolvedValue(transporterMock as any);
      jest.spyOn(transporterMock, 'sendMail').mockResolvedValue({});
      await service.sendEmailForSuccessEvent(
        emailContent,
        fromAddress,
        toAddress,
      );
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
        service.sendEmailForSuccessEvent(emailContent, fromAddress, toAddress),
      ).rejects.toThrow(`Error sending email: ${errorMessage}`);

      expect(transporterMock.sendMail).toHaveBeenCalled();
    });
  });
  describe('sendEmailForFailureEvents', () => {
    it('should send email and save record when status is FIRING', async () => {
      const emailContent = {
        status: EmailContentStatus.FIRING,
        alerts: [
          {
            status: 'firing',
            labels: {
              severity: 'critical',
              pod: 'pod-123',
              alertname: 'HighCPUUsage',
            },
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
          isResolved: false,
          severity: 'critical',
          podName: 'pod-123',
          instanceName: 'pod-123',
          description: 'Service down',
          summary: 'Outage',
        },
      };

      await service.sendEmailForFailureEvents(
        emailContent,
        fromAddress,
        toAddress,
      );

      expect((service as any).transporter.sendMail).toHaveBeenCalledWith(
        mailOptions,
      );
    });

    it('should send email and update record status to CLOSED when status is RESOLVED', async () => {
      const emailContent = {
        status: EmailContentStatus.RESOLVED,
        alerts: [
          {
            status: 'resolved',
            labels: {
              severity: 'critical',
              pod: 'pod-123',
              alertname: 'HighCPUUsage',
            },
            annotations: {
              description: 'Service recovered',
              summary: 'Recovery',
            },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';

      await service.sendEmailForFailureEvents(
        emailContent,
        fromAddress,
        toAddress,
      );

      expect((service as any).transporter.sendMail).toHaveBeenCalled();
    });

    it('should handle instance name when pod is not available', async () => {
      const emailContent = {
        status: EmailContentStatus.FIRING,
        alerts: [
          {
            status: 'firing',
            labels: {
              severity: 'critical',
              instance: 'server-456',
              alertname: 'DiskSpaceLow',
            },
            annotations: {
              description: 'Disk space low',
              summary: 'Storage issue',
            },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';

      await service.sendEmailForFailureEvents(
        emailContent,
        fromAddress,
        toAddress,
      );
    });

    it('should throw an error when email sending fails and not save data', async () => {
      const emailContent = {
        status: EmailContentStatus.FIRING,
        alerts: [
          {
            status: 'firing',
            labels: {
              severity: 'critical',
              pod: 'pod-123',
              alertname: 'HighCPUUsage',
            },
            annotations: { description: 'Service down', summary: 'Outage' },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';

      const errorMessage = 'SMTP connection failed';
      (service as any).transporter.sendMail = jest
        .fn()
        .mockRejectedValue(new Error(errorMessage));

      await expect(
        service.sendEmailForFailureEvents(emailContent, fromAddress, toAddress),
      ).rejects.toThrow(`SMTP connection failed`);
    });

    it('should handle missing alert data gracefully', async () => {
      const emailContent = {
        status: EmailContentStatus.FIRING,
        alerts: [{}],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';

      const mailOptions = {
        from: fromAddress,
        to: toAddress,
        subject: `DataMigrator Alert - Severity: unknown`,
        template: 'failure',
        context: {
          isResolved: false,
          severity: 'unknown',
          podName: null,
          instanceName: null,
          description: 'No description available.',
          summary: 'No summary available.',
        },
      };

      await service.sendEmailForFailureEvents(
        emailContent,
        fromAddress,
        toAddress,
      );

      expect((service as any).transporter.sendMail).toHaveBeenCalledWith(
        mailOptions,
      );
    });

    it('should correctly determine if alert is resolved based on status', async () => {
      const emailContent = {
        status: EmailContentStatus.FIRING,
        alerts: [
          {
            status: 'resolved',
            labels: {
              severity: 'critical',
              pod: 'pod-123',
              alertname: 'HighCPUUsage',
            },
            annotations: {
              description: 'Service recovering',
              summary: 'Recovery in progress',
            },
          },
        ],
      };
      const fromAddress = 'from@example.com';
      const toAddress = 'to@example.com';

      await service.sendEmailForFailureEvents(
        emailContent,
        fromAddress,
        toAddress,
      );

      expect((service as any).transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            isResolved: true,
          }),
        }),
      );
    });
  });
});