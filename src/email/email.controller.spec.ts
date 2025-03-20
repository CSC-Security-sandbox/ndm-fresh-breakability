import { Test, TestingModule } from '@nestjs/testing';
import { EmailController } from './email.controller';
import { EmailService } from './email.service';
import { EmailDto } from './dto/emailDto';
import { Repository } from 'typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));
describe('EmailController', () => {
  let controller: EmailController;
  let service: EmailService;
  let globalSettingsRepo: Repository<GlobalSettings>;;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailController],
      providers: [EmailService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useClass: Repository,
        },
      ],
    }).compile();

    controller = module.get<EmailController>(EmailController);
    service = module.get<EmailService>(EmailService);
    globalSettingsRepo = module.get<Repository<GlobalSettings>>(getRepositoryToken(GlobalSettings));
  });

  describe('create', () => {
    it('should call emailService.setupAndSendMail with the provided email content', () => {
      const emailContent: EmailDto = {
        body: undefined
      };

      const setupAndSendMailSpy = jest.spyOn(service, 'setupAndSendMail');

      controller.create(emailContent);

      expect(setupAndSendMailSpy).toHaveBeenCalledWith(emailContent);
    });
  });
});