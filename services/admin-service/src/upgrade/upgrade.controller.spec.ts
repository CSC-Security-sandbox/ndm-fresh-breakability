import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, StreamableFile } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { Readable } from 'stream';
import { UpgradeController } from './upgrade.controller';
import { UpgradeService } from './upgrade.service';
import { mockLoggerFactory, resetLoggerMocks } from '../test-utils/logger-mocks';


describe('UpgradeController', () => {
  let controller: UpgradeController;
  let upgradeService: UpgradeService;

  const mockUpgradeService = {
    getLatestUploadStatus: jest.fn(),
    initUpload: jest.fn(),
    uploadChunk: jest.fn(),
    processUpload: jest.fn(),
    cancelUpload: jest.fn(),
    triggerUpgrade: jest.fn(),
    skipUpgrade: jest.fn(),
    startMulticast: jest.fn(),
    streamBundle: jest.fn(),
    acknowledgeWorkerDownload: jest.fn(),
    getMulticastStatus: jest.fn(),
    startExecution: jest.fn(),
    acknowledgeExecution: jest.fn(),
    getExecutionStatus: jest.fn(),
    getUpgradeStatus: jest.fn(),
  };

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: { roles: [{ permissions: ['AgentDeployment'], projects: ['project1'] }] },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    resetLoggerMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UpgradeController],
      providers: [
        { provide: UpgradeService, useValue: mockUpgradeService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
      ],
    }).compile();

    controller = module.get<UpgradeController>(UpgradeController);
    upgradeService = module.get<UpgradeService>(UpgradeService);
  });

  // ===========================================================================
  // POST /multicast
  // ===========================================================================

  describe('startMulticast', () => {
    it('should call upgradeService.startMulticast and return result', async () => {
      const expected = {
        workflowId: 'BinaryMulticast-123',
        status: 'started' as const,
        message: 'Multicast workflow started for 2 active workers',
      };
      mockUpgradeService.startMulticast.mockResolvedValue(expected);

      const dto = { bundleId: 'bundle-uuid-123', version: '1.0.0' };
      const result = await controller.startMulticast(dto);

      expect(result).toEqual(expected);
      expect(mockUpgradeService.startMulticast).toHaveBeenCalledWith(dto);
    });

    it('should propagate BadRequestException from precheck failure', async () => {
      mockUpgradeService.startMulticast.mockRejectedValue(
        new BadRequestException('No upgrade bundles found for version 1.0.0'),
      );

      await expect(
        controller.startMulticast({ bundleId: 'bundle-uuid-123', version: '1.0.0' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // GET /worker/download/:version/:platform
  // ===========================================================================

  describe('downloadBundle', () => {
    it('should pipe streamable file to response', async () => {
      const mockStream = new Readable({ read() { this.push(null); } });
      const streamableFile = new StreamableFile(mockStream, {
        type: 'application/gzip',
        disposition: 'attachment; filename="datamigrator-worker-linux-1.0.0.tar.gz"',
        length: 1024,
      });
      mockUpgradeService.streamBundle.mockResolvedValue(streamableFile);

      const mockRes = {
        set: jest.fn(),
      };

      // pipe is on the stream itself
      const pipeSpy = jest.spyOn(mockStream, 'pipe').mockImplementation(() => mockRes as any);

      await controller.downloadBundle('1.0.0', 'linux', mockRes as any);

      expect(mockUpgradeService.streamBundle).toHaveBeenCalledWith('1.0.0', 'linux');
      expect(mockRes.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-cache',
        }),
      );
      expect(pipeSpy).toHaveBeenCalledWith(mockRes);
    });

    it('should propagate NotFoundException when bundle not found', async () => {
      mockUpgradeService.streamBundle.mockRejectedValue(
        new NotFoundException('Bundle not found'),
      );

      const mockRes = { set: jest.fn() };

      await expect(
        controller.downloadBundle('1.0.0', 'linux', mockRes as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException for invalid version', async () => {
      mockUpgradeService.streamBundle.mockRejectedValue(
        new BadRequestException('Invalid version string'),
      );

      const mockRes = { set: jest.fn() };

      await expect(
        controller.downloadBundle('../../../etc/passwd', 'linux', mockRes as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // POST /worker/ack
  // ===========================================================================

  describe('acknowledgeDownload', () => {
    it('should acknowledge successful download', async () => {
      mockUpgradeService.acknowledgeWorkerDownload.mockResolvedValue({ acknowledged: true });

      const result = await controller.acknowledgeDownload({
        workerId: 'worker-1',
        bundleId: 'b1',
        version: '1.0.0',
        status: 'success',
      });

      expect(result).toEqual({ acknowledged: true });
      expect(mockUpgradeService.acknowledgeWorkerDownload).toHaveBeenCalledWith({
        workerId: 'worker-1',
        bundleId: 'b1',
        version: '1.0.0',
        status: 'success',
      });
    });

    it('should acknowledge failed download with message', async () => {
      mockUpgradeService.acknowledgeWorkerDownload.mockResolvedValue({ acknowledged: true });

      const result = await controller.acknowledgeDownload({
        workerId: 'worker-1',
        bundleId: 'b1',
        version: '1.0.0',
        status: 'failed',
        message: 'Checksum mismatch',
      });

      expect(result).toEqual({ acknowledged: true });
      expect(mockUpgradeService.acknowledgeWorkerDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          message: 'Checksum mismatch',
        }),
      );
    });
  });

  // ===========================================================================
  // GET /multicast/:workflowId
  // ===========================================================================

  describe('getMulticastStatus', () => {
    it('should call upgradeService.getMulticastStatus with bundleId', async () => {
      const expected = {
        workflowId: 'BinaryMulticast-123',
        workflowStatus: 'COMPLETED',
        summary: { total: 2, completed: 2, inProgress: 0, failed: 0, idle: 0 },
        workers: [],
      };
      mockUpgradeService.getMulticastStatus.mockResolvedValue(expected);

      const result = await controller.getMulticastStatus('53d5f0cd-bdf8-4e59-86d2-2b4443670586');

      expect(result).toEqual(expected);
      expect(mockUpgradeService.getMulticastStatus).toHaveBeenCalledWith(
        '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
      );
    });
  });

  // ===========================================================================
  // GET /latest-upload-status
  // ===========================================================================

  describe('getLatestStatus', () => {
    it('should return latest upload status', async () => {
      const expected = { id: 'bundle-1', uploadStatus: 'success' };
      mockUpgradeService.getLatestUploadStatus.mockResolvedValue(expected);

      const result = await controller.getLatestStatus();

      expect(result).toEqual(expected);
      expect(mockUpgradeService.getLatestUploadStatus).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // POST /init
  // ===========================================================================

  describe('initUpload', () => {
    it('should initialize upload session', async () => {
      const expected = { uploadId: 'uuid-1', status: 'initialized' };
      mockUpgradeService.initUpload.mockResolvedValue(expected);
      const userPerms = { user: { id: 'user-1' } } as any;

      const result = await controller.initUpload(
        { fileName: 'upgrade-1.0.0.tar.gz', fileSize: 1024 },
        userPerms,
      );

      expect(result).toEqual(expected);
      expect(mockUpgradeService.initUpload).toHaveBeenCalledWith(
        { fileName: 'upgrade-1.0.0.tar.gz', fileSize: 1024 },
        'user-1',
      );
    });
  });

  // ===========================================================================
  // POST /chunk-upload/:uploadId
  // ===========================================================================

  describe('uploadChunk', () => {
    it('should upload a chunk with valid header', async () => {
      const expected = { received: true, chunkIndex: 0 };
      mockUpgradeService.uploadChunk.mockResolvedValue(expected);

      const mockReq = { headers: { 'x-chunk-index': '0' } } as any;
      const result = await controller.uploadChunk('uuid-1', mockReq);

      expect(result).toEqual(expected);
      expect(mockUpgradeService.uploadChunk).toHaveBeenCalledWith('uuid-1', 0, mockReq);
    });

    it('should throw BadRequestException for missing header', async () => {
      const mockReq = { headers: {} } as any;

      await expect(controller.uploadChunk('uuid-1', mockReq)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid header', async () => {
      const mockReq = { headers: { 'x-chunk-index': 'abc' } } as any;

      await expect(controller.uploadChunk('uuid-1', mockReq)).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // POST /process-upload/:uploadId
  // ===========================================================================

  describe('processUpload', () => {
    it('should process upload', async () => {
      const expected = { status: 'success', version: '1.0.0' };
      mockUpgradeService.processUpload.mockResolvedValue(expected);

      const result = await controller.processUpload('uuid-1');

      expect(result).toEqual(expected);
      expect(mockUpgradeService.processUpload).toHaveBeenCalledWith('uuid-1');
    });
  });

  // ===========================================================================
  // POST /cancel-upload/:uploadId
  // ===========================================================================

  describe('cancelUpload', () => {
    it('should cancel upload', async () => {
      const expected = { cancelled: true };
      mockUpgradeService.cancelUpload.mockResolvedValue(expected);

      const result = await controller.cancelUpload('uuid-1');

      expect(result).toEqual(expected);
      expect(mockUpgradeService.cancelUpload).toHaveBeenCalledWith('uuid-1');
    });
  });

  // ===========================================================================
  // POST /trigger-upgrade
  // ===========================================================================

  describe('triggerUpgrade', () => {
    it('should trigger upgrade', async () => {
      const expected = { status: 'success' };
      mockUpgradeService.triggerUpgrade.mockResolvedValue(expected);
      const userPerms = { user: { id: 'user-1' } } as any;

      const result = await controller.triggerUpgrade({ bundleId: 'bundle-1' }, userPerms);

      expect(result).toEqual(expected);
      expect(mockUpgradeService.triggerUpgrade).toHaveBeenCalledWith('bundle-1', 'user-1');
    });
  });

  // ===========================================================================
  // POST /skip
  // ===========================================================================

  describe('skipUpgrade', () => {
    it('should skip upgrade', async () => {
      const expected = { skipped: true };
      mockUpgradeService.skipUpgrade.mockResolvedValue(expected);

      const result = await controller.skipUpgrade({ bundleId: 'bundle-1' });

      expect(result).toEqual(expected);
      expect(mockUpgradeService.skipUpgrade).toHaveBeenCalledWith('bundle-1');
    });
  });

  // ===========================================================================
  // POST /execute
  // ===========================================================================

  describe('startExecution', () => {
    it('should start execution and return workflow id', async () => {
      const expected = {
        workflowId: 'UpgradeExecution-123',
        status: 'started' as const,
        message: 'Upgrade execution triggered for 3 workers',
        triggeredWorkers: ['w1', 'w2', 'w3'],
      };
      mockUpgradeService.startExecution.mockResolvedValue(expected);

      const dto = { bundleId: 'bundle-1', version: '1.0.0' };
      const result = await controller.startExecution(dto);

      expect(result).toEqual(expected);
      expect(mockUpgradeService.startExecution).toHaveBeenCalledWith(dto);
    });

    it('should return started when no staged workers', async () => {
      const expected = {
        workflowId: 'UpgradeExecution-123',
        status: 'started' as const,
        message: 'No workers have staged binaries. Execution marked as completed.',
        triggeredWorkers: [],
      };
      mockUpgradeService.startExecution.mockResolvedValue(expected);

      const result = await controller.startExecution({ bundleId: 'bundle-1', version: '1.0.0' });
      expect(result.status).toBe('started');
      expect(result.triggeredWorkers).toEqual([]);
    });
  });

  // ===========================================================================
  // POST /worker/execution-ack
  // ===========================================================================

  describe('acknowledgeExecution', () => {
    it('should acknowledge successful execution', async () => {
      mockUpgradeService.acknowledgeExecution.mockResolvedValue({
        acknowledged: true,
        message: 'Worker upgraded to 1.0.0',
      });

      const result = await controller.acknowledgeExecution({
        workerId: 'worker-1',
        bundleId: 'b1',
        version: '1.0.0',
      });

      expect(result).toEqual({ acknowledged: true, message: 'Worker upgraded to 1.0.0' });
      expect(mockUpgradeService.acknowledgeExecution).toHaveBeenCalledWith({
        workerId: 'worker-1',
        bundleId: 'b1',
        version: '1.0.0',
      });
    });
  });

  // ===========================================================================
  // GET /execute/:bundleId/:version
  // ===========================================================================

  describe('getExecutionStatus', () => {
    it('should return execution status', async () => {
      const expected = {
        workflowId: 'UpgradeExecution-123',
        workflowStatus: 'COMPLETED',
        summary: { total: 2, completed: 2, inProgress: 0, failed: 0, notStarted: 0 },
        completed: [],
        notCompleted: [],
        notStaged: [],
      };
      mockUpgradeService.getExecutionStatus.mockResolvedValue(expected);

      const result = await controller.getExecutionStatus('53d5f0cd-bdf8-4e59-86d2-2b4443670586');

      expect(result).toEqual(expected);
      expect(mockUpgradeService.getExecutionStatus).toHaveBeenCalledWith(
        '53d5f0cd-bdf8-4e59-86d2-2b4443670586',
      );
    });
  });

  // ===========================================================================
  // GET /upgrade-status
  // ===========================================================================

  describe('getUpgradeStatus', () => {
    it('should return upgrade status when upgrade succeeded', async () => {
      const expected = {
        status: 'success',
        version: '2026.02.01',
        message: 'Upgrade completed successfully',
      };
      mockUpgradeService.getUpgradeStatus.mockResolvedValue(expected);

      const result = await controller.getUpgradeStatus();

      expect(result).toEqual(expected);
      expect(mockUpgradeService.getUpgradeStatus).toHaveBeenCalled();
    });

    it('should return upgrade status when upgrade failed', async () => {
      const expected = {
        status: 'failed',
        version: '2026.02.01',
        message: 'Upgrade failed: pod readiness timeout',
      };
      mockUpgradeService.getUpgradeStatus.mockResolvedValue(expected);

      const result = await controller.getUpgradeStatus();

      expect(result).toEqual(expected);
      expect(mockUpgradeService.getUpgradeStatus).toHaveBeenCalled();
    });

    it('should return upgrade status when no upgrade in progress', async () => {
      const expected = {
        status: 'none',
        message: 'No upgrade in progress',
      };
      mockUpgradeService.getUpgradeStatus.mockResolvedValue(expected);

      const result = await controller.getUpgradeStatus();

      expect(result).toEqual(expected);
    });
  });
});
