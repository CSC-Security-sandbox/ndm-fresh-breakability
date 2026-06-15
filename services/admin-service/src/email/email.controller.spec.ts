import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailDto } from './dto/emailDto';
import { Repository } from 'typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncEmail } from 'src/entities/sync-email.entity';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { mockLoggerFactory, resetLoggerMocks, mockLoggerService } from '../test-utils/logger-mocks';

jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));

describe('EmailController', () => {
  let controller: EmailController;
  let service: EmailService;

  const mockGlobalSettingsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const mockSyncEmailRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    resetLoggerMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        EmailService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: mockGlobalSettingsRepo,
        },
        {
          provide: getRepositoryToken(SyncEmail),
          useValue: mockSyncEmailRepo,
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: JwtService,
          useValue: { verifyToken: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
    service = module.get<EmailService>(EmailService);
  });

  describe('create', () => {
    it('should call emailService.setupAndSendMail with the provided email content', () => {
      const emailContent: EmailDto = {
        body: undefined,
      };

      const setupAndSendMailSpy = jest.spyOn(service, 'setupAndSendMail');

      controller.create(emailContent);

      expect(setupAndSendMailSpy).toHaveBeenCalledWith(emailContent, 'FAILURE');
    });
  });
});
