import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { Context } from '@temporalio/activity';
import axios from 'axios';
import { UpgradeActivityService } from './upgrade.activity.service';
import { AuthService } from '../../auth/auth.service';

jest.mock('axios');
jest.mock('@temporalio/activity', () => ({
  Context: { current: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('UpgradeActivityService', () => {
  let service: UpgradeActivityService;

  const mockHandler = {
    download: jest.fn(),
    isBinaryStaged: jest.fn(),
  };

  const mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn() };
  const mockLoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) };
  const mockConfigService = { get: jest.fn().mockReturnValue('worker-123') };
  const mockAuthService = { getAccessToken: jest.fn() };

  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CP_BASE_URL: 'http://localhost:3001' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradeActivityService,
        { provide: 'BINARY_HANDLER', useValue: mockHandler },
        { provide: LoggerFactory, useValue: mockLoggerFactory },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<UpgradeActivityService>(UpgradeActivityService);
  });

  afterAll(() => { process.env = originalEnv; });

  // ===========================================================================
  // isBinaryStaged
  // ===========================================================================

  describe('isBinaryStaged', () => {
    it('should delegate to handler', async () => {
      mockHandler.isBinaryStaged.mockResolvedValue({ staged: true, platform: 'linux' });

      const result = await service.isBinaryStaged('1.0.0');

      expect(result).toEqual({ staged: true, platform: 'linux' });
      expect(mockHandler.isBinaryStaged).toHaveBeenCalledWith('1.0.0');
    });

    it('should return false when not staged', async () => {
      mockHandler.isBinaryStaged.mockResolvedValue({ staged: false, platform: 'windows' });

      const result = await service.isBinaryStaged('1.0.0');

      expect(result).toEqual({ staged: false, platform: 'windows' });
    });
  });

  // ===========================================================================
  // downloadBundle
  // ===========================================================================

  describe('downloadBundle', () => {
    it('should delegate to handler with heartbeat callback', async () => {
      const mockOutput = {
        stagedPath: '/staging/1.0.0',
        sizeBytes: 1024,
        platform: 'linux' as const,
        binaryPath: '/staging/1.0.0/binary',
        envPath: '/staging/1.0.0/.env',
      };
      mockHandler.download.mockResolvedValue(mockOutput);

      const result = await service.downloadBundle({ bundleId: 'b1', version: '1.0.0' });

      expect(result).toEqual(mockOutput);
      expect(mockHandler.download).toHaveBeenCalledWith('1.0.0', expect.any(Function), 'b1');
    });

    it('should propagate handler errors', async () => {
      mockHandler.download.mockRejectedValue(new Error('Download failed'));

      await expect(service.downloadBundle({ bundleId: 'b1', version: '1.0.0' })).rejects.toThrow('Download failed');
    });
  });

  // ===========================================================================
  // ackUpgrade
  // ===========================================================================

  describe('ackUpgrade', () => {
    it('should POST ack with auth token', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('jwt-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await service.ackUpgrade({ bundleId: 'b1', version: '1.0.0', status: 'success' });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:3001/api/v1/upgrade/worker/ack',
        expect.objectContaining({
          workerId: 'worker-123',
          version: '1.0.0',
          status: 'success',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer jwt-token',
          }),
        }),
      );
    });

    it('should POST ack without auth when token is null', async () => {
      mockAuthService.getAccessToken.mockResolvedValue(null);
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await service.ackUpgrade({ bundleId: 'b1', version: '1.0.0', status: 'failed', message: 'error' });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ status: 'failed', message: 'error' }),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should not throw when POST fails', async () => {
      mockAuthService.getAccessToken.mockResolvedValue('token');
      mockedAxios.post.mockRejectedValue({ response: { status: 500 }, message: 'Internal Server Error' });

      await expect(
        service.ackUpgrade({ bundleId: 'b1', version: '1.0.0', status: 'success' }),
      ).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to send ack'));
    });

    it('should throw when CP env vars are missing', async () => {
      delete process.env.CP_BASE_URL;
      delete process.env.CONTROL_PLANE_IP;

      await expect(
        service.ackUpgrade({ bundleId: 'b1', version: '1.0.0', status: 'success' }),
      ).rejects.toThrow('Neither CP_BASE_URL nor CONTROL_PLANE_IP');
    });

    it('should construct URL from CONTROL_PLANE_IP when CP_BASE_URL is missing', async () => {
      delete process.env.CP_BASE_URL;
      process.env.CONTROL_PLANE_IP = '10.0.0.1';
      mockAuthService.getAccessToken.mockResolvedValue('token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await service.ackUpgrade({ bundleId: 'b1', version: '1.0.0', status: 'success' });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://10.0.0.1/api/v1/upgrade/worker/ack',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ===========================================================================
  // heartbeat
  // ===========================================================================

  describe('heartbeat', () => {
    it('should call Temporal Context heartbeat', () => {
      const mockHeartbeat = jest.fn();
      (Context.current as jest.Mock).mockReturnValue({ heartbeat: mockHeartbeat });

      (service as any).heartbeat('test-stage');

      expect(mockHeartbeat).toHaveBeenCalledWith({ stage: 'test-stage' });
    });

    it('should not throw when Context is unavailable', () => {
      (Context.current as jest.Mock).mockImplementation(() => { throw new Error('No context'); });

      expect(() => (service as any).heartbeat('test-stage')).not.toThrow();
      expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Heartbeat failed'));
    });
  });
});
