import { EmailService } from './email.service';
import { Repository } from 'typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import * as nodemailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('EmailService', () => {
  let emailService: EmailService;
  let settingsRepo: Repository<GlobalSettings>;
  let sendMailMock: jest.Mock;
  let verifyMock: jest.Mock;
  let useMock : jest.Mock;

  beforeEach(() => {
    sendMailMock = jest.fn().mockResolvedValue({ messageId: '12345' });
    verifyMock = jest.fn().mockResolvedValue(true);

    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
      verify: verifyMock,
      use: jest.fn(),
    });

    settingsRepo = {
      find: jest.fn(),
    } as unknown as Repository<GlobalSettings>;

    emailService = new EmailService(settingsRepo);
  });

  it('should fetch SMTP settings from database', async () => {
    const mockSettings = [
      { settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com' },
      { settingKey: 'SMTP_PORT', settingValue: '587' },
      { settingKey: 'SMTP_USER_NAME', settingValue: 'user@example.com' },
      { settingKey: 'SMTP_PASSWORD', settingValue: 'password' },
      { settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com' },
      { settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com' },
    ] as GlobalSettings[];

    (settingsRepo.find as jest.Mock).mockResolvedValue(mockSettings);

    const settings = await emailService.getSMTPSettings();
    expect(settings).toEqual(mockSettings);
    expect(settingsRepo.find).toHaveBeenCalledWith({
      where: { settingType: expect.any(String) },
    });
  });


  it('should throw an error if sending email fails', async () => {
    emailService.transporter = nodemailer.createTransport();
    sendMailMock.mockRejectedValueOnce(new Error('SMTP Error'));

    const emailContent = {
      alerts: [
        {
          labels: { severity: 'low', pod: 'pod2' },
          annotations: { description: 'Test Desc 2', summary: 'Test Summary 2' },
        },
      ],
    };

    await expect(
      emailService.sendEmail(emailContent, 'from@example.com', 'to@example.com'),
    ).rejects.toThrow('Error sending email: SMTP Error');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
  

  it('should set up the transporter and send an email', async () => {
    const mockSettings = [
      { settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com' },
      { settingKey: 'SMTP_PORT', settingValue: '587' },
      { settingKey: 'SMTP_USER_NAME', settingValue: 'user@example.com' },
      { settingKey: 'SMTP_PASSWORD', settingValue: 'password' },
      { settingKey: 'SMTP_FROM_EMAIL', settingValue: 'from@example.com' },
      { settingKey: 'SMTP_TO_EMAIL', settingValue: 'to@example.com' },
    ] as GlobalSettings[];

    (settingsRepo.find as jest.Mock).mockResolvedValue(mockSettings);

    const emailContent = {
      alerts: [
        {
          labels: { severity: 'critical', pod: 'podX' },
          annotations: { description: 'Urgent issue', summary: 'Immediate action needed' },
        },
      ],
    };

    await emailService.setupTransporter(emailContent);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'user@example.com',
        pass: 'password',
      },
      socketTimeout: 5000,
      connectionTimeout: 5000,
    });
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect.objectContaining({
      from: 'from@example.com',
      to: 'to@example.com',
    })
  });

  it('should handle error in setupTransporter', async () => {
    (settingsRepo.find as jest.Mock).mockRejectedValueOnce(new Error('DB error'));

    const emailContent = {
      alerts: [],
    };

    await expect(emailService.setupTransporter(emailContent)).rejects.toThrow(
      'Error setting up SMTP transporter and sending mail: DB error',
    );
  });

  it('should return success message when setupAndSendMail succeeds', async () => {
    jest.spyOn(emailService, 'setupTransporter').mockResolvedValueOnce(undefined);

    const emailContent = { alerts: [] };
    const result = await emailService.setupAndSendMail(emailContent);

    expect(result).toEqual({ message: 'Email sent successfully', statusCode: 200 });
  });

  it('should return error message when setupAndSendMail fails', async () => {
    jest.spyOn(emailService, 'setupTransporter').mockRejectedValueOnce(new Error('SMTP setup failed'));

    const emailContent = { alerts: [] };
    const result = await emailService.setupAndSendMail(emailContent);

    expect(result).toEqual({ message: 'SMTP setup failed', statusCode: 500 });
  });
});
