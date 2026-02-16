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
    startMulticast: jest.fn(),
    streamBundle: jest.fn(),
    acknowledgeWorkerDownload: jest.fn(),
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

      const result = await controller.startMulticast({ version: '1.0.0' });

      expect(result).toEqual(expected);
      expect(mockUpgradeService.startMulticast).toHaveBeenCalledWith({ version: '1.0.0' });
    });

    it('should propagate BadRequestException from precheck failure', async () => {
      mockUpgradeService.startMulticast.mockRejectedValue(
        new BadRequestException('No upgrade bundles found for version 1.0.0'),
      );

      await expect(
        controller.startMulticast({ version: '1.0.0' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // GET /worker/:version/:platform
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
        version: '1.0.0',
        status: 'success',
      });

      expect(result).toEqual({ acknowledged: true });
      expect(mockUpgradeService.acknowledgeWorkerDownload).toHaveBeenCalledWith({
        workerId: 'worker-1',
        version: '1.0.0',
        status: 'success',
      });
    });

    it('should acknowledge failed download with message', async () => {
      mockUpgradeService.acknowledgeWorkerDownload.mockResolvedValue({ acknowledged: true });

      const result = await controller.acknowledgeDownload({
        workerId: 'worker-1',
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
});
