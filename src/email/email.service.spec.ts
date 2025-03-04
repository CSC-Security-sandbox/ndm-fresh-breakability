import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailService],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
  describe('sendEmail', () => {
    it('should send an email successfully', () => {
      const emailContent = 'Hello, this is the email content';
      const result = service.sendEmail(emailContent);
      expect(result).toEqual({ message: 'Email sent successfully', statusCode: 200 });
    });
  });
});
