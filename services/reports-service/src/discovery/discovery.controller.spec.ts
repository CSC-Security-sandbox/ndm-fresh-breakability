import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { BadRequestException } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { ReportType } from './pattern.enum';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

describe('DiscoveryController', () => {
  let controller: DiscoveryController;
  let service: DiscoveryService;
  let mockLogger: any;

  const mockDiscoveryService = {
    getDiscoveryByFileServerId: jest.fn(),
    getDiscoveryByFileServerIdAndParentPath: jest.fn(),
    createReportFile: jest.fn(),
    createJobsPDFReportData: jest.fn(),
    prepareDownload: jest.fn(),
    streamZipToResponse: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ["permission1", "permission2"],
            projects: ["project1"],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [
        {
          provide: DiscoveryService,
          useValue: mockDiscoveryService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: LoggerFactory,
          useValue: {
            create: jest.fn().mockReturnValue(mockLogger),
          },
        },
      ],
    }).compile();

    controller = module.get<DiscoveryController>(DiscoveryController);
    service = module.get<DiscoveryService>(DiscoveryService);
    
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('discoverFileServerDefault', () => {
    it('should get discovery by file server id', async () => {
      const fileServerId = 'test-id';
      const expectedResult = [{ id: 'test' }];
      mockDiscoveryService.getDiscoveryByFileServerId.mockResolvedValue(expectedResult);

      const result = await controller.discoverFileServerDefault(fileServerId);

      expect(result).toBe(expectedResult);
      expect(service.getDiscoveryByFileServerId).toHaveBeenCalledWith(fileServerId);
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(controller.discoverFileServerDefault('')).rejects.toThrow(
        new BadRequestException('fileServerId query parameter is required')
      );
    });
  });

  describe('discoverFileServerWithPath', () => {
    it('should get discovery by file server id and parent path', async () => {
      const fileServerId = 'test-id';
      const parentPath = '/test/path';
      const expectedResult = [{ id: 'test' }];
      mockDiscoveryService.getDiscoveryByFileServerIdAndParentPath.mockResolvedValue(expectedResult);

      const result = await controller.discoverFileServerWithPath(fileServerId, parentPath);

      expect(result).toBe(expectedResult);
      expect(service.getDiscoveryByFileServerIdAndParentPath).toHaveBeenCalledWith(
        fileServerId,
        parentPath
      );
    });

    it('should throw BadRequestException when fileServerId is missing', async () => {
      await expect(controller.discoverFileServerWithPath('', '/test/path')).rejects.toThrow(
        new BadRequestException('fileServerId query parameter is required')
      );
    });
  });

  describe('generateReport', () => {
    it('should generate report successfully', async () => {
      const jobRunId = 'job1';
      const reportType = ReportType.DISCOVERY;
      const expectedResult = "OK";
      mockDiscoveryService.createReportFile.mockResolvedValue(expectedResult);

      const result = await controller.generateReport(jobRunId, reportType);

      expect(result).toBe(expectedResult);
      expect(service.createReportFile).toHaveBeenCalledWith(jobRunId, reportType);
    });

    it('should throw BadRequestException when jobRunId is missing', async () => {
      await expect(controller.generateReport('', ReportType.DISCOVERY)).rejects.toThrow(
        new BadRequestException('jobRunId is required')
      );
    });

    it('should throw BadRequestException when reportType is invalid', async () => {
      await expect(controller.generateReport('job1', 'INVALID' as any)).rejects.toThrow(
        new BadRequestException('Invalid report type. Allowed values are COC or DISCOVERY')
      );
    });

    it('should throw BadRequestException when reportType is missing', async () => {
      await expect(controller.generateReport('job1', '' as any)).rejects.toThrow(
        new BadRequestException('Invalid report type. Allowed values are COC or DISCOVERY')
      );
    });

    it('should log when generating report', async () => {
      const logSpy = jest.spyOn(mockLogger, 'log');
      const jobRunId = 'job1';
      const reportType = ReportType.DISCOVERY;
      mockDiscoveryService.createReportFile.mockResolvedValue({ message: 'success' });

      await controller.generateReport(jobRunId, reportType);

      expect(logSpy).toHaveBeenCalledWith('reached here in controller');
      logSpy.mockRestore();
    });
  });

  describe('prepareDownload', () => {
    it('should return a token on success', async () => {
      mockDiscoveryService.prepareDownload.mockResolvedValue('test-token');

      const result = await controller.prepareDownload('job1', ReportType.DISCOVERY);

      expect(result).toEqual({ token: 'test-token' });
      expect(mockDiscoveryService.prepareDownload).toHaveBeenCalledWith('job1', ReportType.DISCOVERY);
    });

    it('should throw BadRequestException when jobRunId is missing', async () => {
      await expect(
        controller.prepareDownload('', ReportType.DISCOVERY)
      ).rejects.toThrow(new BadRequestException('jobRunId is required'));
    });

    it('should throw BadRequestException when reportType is invalid', async () => {
      await expect(
        controller.prepareDownload('job1', 'INVALID' as any)
      ).rejects.toThrow(new BadRequestException('Invalid report type. Allowed values are COC or discovery'));
    });
  });

  describe('downloadByToken', () => {
    it('should delegate to streamZipToResponse', async () => {
      const mockRes: any = { set: jest.fn(), end: jest.fn() };
      mockDiscoveryService.streamZipToResponse.mockResolvedValue(undefined);

      await controller.downloadByToken('my-token', mockRes);

      expect(mockDiscoveryService.streamZipToResponse).toHaveBeenCalledWith('my-token', mockRes);
    });
  });

  describe('generateJobsReport', () => {
    it('should fire createJobsPDFReportData and return OK', async () => {
      mockDiscoveryService.createJobsPDFReportData.mockResolvedValue(undefined);

      const result = await controller.generateJobsReport('job1');

      expect(result).toBe('OK');
      expect(mockDiscoveryService.createJobsPDFReportData).toHaveBeenCalledWith('job1');
    });
  });

  describe('generateDiscoveryReport', () => {
    let mockContext: RmqContext;
    let mockChannel;

    beforeEach(() => {
      mockChannel = {
        ack: jest.fn(),
        nack: jest.fn(),
      };
      mockContext = {
        getChannelRef: jest.fn().mockReturnValue(mockChannel),
        getMessage: jest.fn(),
      } as unknown as RmqContext;
    });

    it('should process discovery completed message successfully', async () => {
      const payload = { jobRunId: 'job1' };
      mockDiscoveryService.createReportFile.mockResolvedValue({ message: 'success' });

      await controller.generateDiscoveryReport(payload, mockContext);

      expect(service.createReportFile).toHaveBeenCalledWith(payload.jobRunId, 'DISCOVERY');
      expect(mockChannel.ack).toHaveBeenCalled();
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should log received message', async () => {
      const payload = { jobRunId: 'job1' };
      const logSpy = jest.spyOn(mockLogger, 'log');
      mockDiscoveryService.createReportFile.mockResolvedValue({ message: 'success' });

      await controller.generateDiscoveryReport(payload, mockContext);

      expect(logSpy).toHaveBeenCalledWith(
        `Received discovery completed message: ${JSON.stringify(payload)}`
      );
      logSpy.mockRestore();
    });

    it('should nack the message when createReportFile throws', async () => {
      const payload = { jobRunId: 'job1' };
      mockDiscoveryService.createReportFile.mockImplementation(() => {
        throw new Error('report generation failed');
      });

      await controller.generateDiscoveryReport(payload, mockContext);

      expect(mockChannel.nack).toHaveBeenCalled();
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });
  });
});
