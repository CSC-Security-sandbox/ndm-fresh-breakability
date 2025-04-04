import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailDto } from './dto/emailDto';
import { Repository } from 'typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncEmail } from 'src/entities/sync-email.entity';
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));
describe('EmailController', () => {
  let controller: EmailController;
  let service: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [
        EmailService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(SyncEmail),
          useClass: Repository,
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
