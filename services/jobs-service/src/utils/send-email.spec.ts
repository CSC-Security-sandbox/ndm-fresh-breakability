import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SendMailService } from './send-email';
import { SuccessEmailType } from './send-email.type';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('axios');

describe('SendMailService', () => {
  let service: SendMailService;
  let configService: ConfigService;
  let mockPost: jest.MockedFunction<typeof axios.post>;

  beforeEach(async () => {
    mockPost = axios.post as jest.MockedFunction<typeof axios.post>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendMailService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://mock-email-service'),
          },
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
              verbose: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SendMailService>(SendMailService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should send email successfully', async () => {
    const mockResponse = {
      status: 200,
      data: { message: 'Email sent successfully' },
    };
    mockPost.mockResolvedValue(mockResponse);

    const emailBody = {
      workerUsage: {
        id: 'test-worker',
        ip: '192.168.1.1',
      },
      successEmailType: SuccessEmailType.WORKER_USES,
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      { headers: {} },
    );
    expect(result).toEqual(mockResponse.data);
  });

  it('should handle failure when email sending fails', async () => {
    mockPost.mockResolvedValue({
      status: 500,
      data: { error: 'Internal Server Error' },
    });

    const emailBody = {
      workerUsage: {
        id: 'test-worker',
        ip: '192.168.1.1',
      },
      successEmailType: SuccessEmailType.WORKER_USES,
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      { headers: {} },
    );
    expect(result).toBeUndefined();
  });

  it('should handle axios exceptions gracefully', async () => {
    mockPost.mockRejectedValue(new Error('Network Error'));

    const emailBody = {
      workerUsage: {
        id: 'test-worker',
        ip: '192.168.1.1',
      },
      successEmailType: SuccessEmailType.WORKER_USES,
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      { headers: {} },
    );
    expect(result).toBeUndefined();
  });

  it('should include traceId and projectId in headers when provided', async () => {
    const mockResponse = {
      status: 200,
      data: { message: 'Email sent successfully' },
    };
    mockPost.mockResolvedValue(mockResponse);

    const emailBody = {
      workerUsage: {
        id: 'test-worker',
        ip: '192.168.1.1',
      },
      successEmailType: SuccessEmailType.WORKER_USES,
      traceId: 'trace-123',
      projectId: 'project-456',
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      {
        headers: {
          trackId: 'trace-123',
          projectId: 'project-456',
        },
      },
    );
    expect(result).toEqual(mockResponse.data);
  });
});
