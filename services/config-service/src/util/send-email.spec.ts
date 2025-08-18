import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { SendMailService } from "./send-email";
import { SuccessEmailType } from "./send-email.type";

jest.mock("axios");

describe("SendMailService", () => {
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
            get: jest.fn().mockReturnValue("http://mock-email-service"),
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

  it("should send email successfully", async () => {
    const mockResponse = { status: 200, data: { message: "Email sent successfully" } };
    mockPost.mockResolvedValue(mockResponse);

    const emailBody = {
      successEmailType: SuccessEmailType.WORKER_USAGE,
      projectId: "test-project-id",
      traceId: "test-trace-id",
      workerUsage: {
        id: "test-worker",
        ip: "127.0.0.1",
      }
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      {
        timeout: 30000,
        headers: {
          'trackId': 'test-trace-id',
          'projectId': 'test-project-id'
        }
      },
    );
    expect(result).toEqual(mockResponse.data);
  });

  it("should handle failure when email sending fails", async () => {
    mockPost.mockResolvedValue({ status: 500, data: { error: "Internal Server Error" } });

    const emailBody = {
      successEmailType: SuccessEmailType.WORKER_USAGE,
      projectId: "test-project-id",
      traceId: "test-trace-id",
      workerUsage: {
        id: "test-worker",
        ip: "127.0.0.1",
      }
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      {
        timeout: 30000,
        headers: {
          'trackId': 'test-trace-id',
          'projectId': 'test-project-id'
        }
      },
    );
    expect(result).toBeUndefined();
  });

  it("should handle axios exceptions gracefully", async () => {
    mockPost.mockRejectedValue(new Error("Network Error"));

    const emailBody = {
      successEmailType: SuccessEmailType.WORKER_USAGE,
      projectId: "test-project-id",
      traceId: "test-trace-id",
      workerUsage: {
        id: "test-worker",
        ip: "127.0.0.1",
      }
    };

    const result = await service.sendMail(emailBody);

    expect(mockPost).toHaveBeenCalledWith(
      'http://mock-email-service/api/v1/email/internal',
      emailBody,
      {
        timeout: 30000,
        headers: {
          'trackId': 'test-trace-id',
          'projectId': 'test-project-id'
        }
      },
    );
    expect(result).toBeUndefined();
  });
});