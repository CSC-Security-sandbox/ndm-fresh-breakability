import { Test, TestingModule } from '@nestjs/testing';
import { SetupActivityService } from './setup.activity.service';
import { ConfigService } from '@nestjs/config';
import { RedisService } from 'src/redis/redis.service';
import { Logger } from '@nestjs/common';
import { Protocols } from 'src/protocols/protocols';
import axios from 'axios';
import * as fs from 'fs';
import * as util from 'util';
import { HttpService } from '@nestjs/axios';


describe('SetupActivityService', () => {
  let service: SetupActivityService;

  jest.mock('axios');
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  mockedAxios.post = jest.fn();

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        'worker.workerId': 'test-worker-id',
        'worker.workerConfigUrl': 'http://localhost:3000',
        'worker.baseWorkingPath': '/tmp',
        'keycloak': { workerSecret: 'test-secret' },
      };
      return config[key];
    }),
  };

  const mockRedisService = {
    getJobContext: jest.fn(),
  };

  const mockProtocol = {
    mountPath: jest.fn(),
    unmountPath: jest.fn(),
  };

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SetupActivityService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: Logger, useValue: mockLogger },
        { provide: Protocols, useValue: mockProtocol },
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
      ],
    }).compile();

    service = module.get<SetupActivityService>(SetupActivityService);

    jest.spyOn(Protocols, 'getProtocol').mockReturnValue(mockProtocol as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should mount and check write permission successfully', async () => {
    const payload = {
      protocols: { type: 'NFS', userName: 'user', password: 'pass' },
      hostname: 'test-host',
      pathId: '123',
      exportPathName: '/export/path',
      protocolVersion: 'v1',
      type: 'SOURCE',
    };
    const traceId = 'trace-123';

    mockProtocol.mountPath.mockResolvedValue({ status: 'success' });
    jest
      .spyOn(service, 'checkWritePermission')
      .mockResolvedValue({ status: 'success' });

    const result = await service.mountAndCheckWritePermission(
      payload,
      traceId,
      true,
    );

    expect(mockLogger.log).toHaveBeenCalledWith(
      `[${traceId}] - Mounting path  /export/path for test-host ---- ${JSON.stringify(
        {
          hostname: 'test-host',
          username: 'user',
          password: 'pass',
          protocolVersion: 'v1',
          path: '/export/path',
          mountBasePath: '/tmp',
          pathId: '123',
          jobRunId: traceId,
        },
      )}`,
    );
    expect(mockProtocol.mountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(service.checkWritePermission).toHaveBeenCalledWith(
      '/export/path',
      '123',
      traceId,
      '/tmp',
      'test-host',
      'user',
      'pass',
      mockProtocol,
      'SOURCE',
      'v1',
    );
    expect(result).toEqual({ status: 'success' });
  });

  it('should return failure if mountPath fails', async () => {
    const payload = {
      protocols: { type: 'NFS', userName: 'user', password: 'pass' },
      hostname: 'test-host',
      pathId: '123',
      exportPathName: '/export/path',
      protocolVersion: 'v1',
      type: 'DESTINATION',
    };
    const traceId = 'trace-123';

    mockProtocol.mountPath.mockResolvedValue({ status: 'error' });

    const result = await service.mountAndCheckWritePermission(
      payload,
      traceId,
      true,
    );

    expect(mockProtocol.mountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(result).toEqual({
      destinationId: '123',
      status: 'failed',
      errors: ['DESTINATION_PATH_MOUNT_FAILED'],
    });
  });

  it('should return failure if write permission check fails', async () => {
    const payload = {
      protocols: { type: 'NFS', userName: 'user', password: 'pass' },
      hostname: 'test-host',
      pathId: '123',
      exportPathName: '/export/path',
      protocolVersion: 'v1',
      type: 'SOURCE',
    };
    const traceId = 'trace-123';

    mockProtocol.mountPath.mockResolvedValue({ status: 'success' });
    jest
      .spyOn(service, 'checkWritePermission')
      .mockResolvedValue({ status: 'failed' });

    const result = await service.mountAndCheckWritePermission(
      payload,
      traceId,
      true,
    );

    expect(mockProtocol.mountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(service.checkWritePermission).toHaveBeenCalledWith(
      '/export/path',
      '123',
      traceId,
      '/tmp',
      'test-host',
      'user',
      'pass',
      mockProtocol,
      'SOURCE',
      'v1',
    );
    expect(mockProtocol.unmountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(result).toEqual({
      sourceId: '123',
      status: 'failed',
      errors: ['SOURCE_PATH_WRITE_PERMISSION_FAILED'],
    });
  });

  it('should skip write permission check if checkWritePermission is false', async () => {
    const payload = {
      protocols: { type: 'NFS', userName: 'user', password: 'pass' },
      hostname: 'test-host',
      pathId: '123',
      exportPathName: '/export/path',
      protocolVersion: 'v1',
      type: 'DESTINATION',
    };
    const traceId = 'trace-123';

    mockProtocol.mountPath.mockResolvedValue({ status: 'success' });

    const result = await service.mountAndCheckWritePermission(
      payload,
      traceId,
      false,
    );

    expect(mockProtocol.mountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(mockProtocol.unmountPath).toHaveBeenCalledWith(
      traceId,
      expect.any(Object),
    );
    expect(result).toEqual({
      destinationId: '123',
      status: 'success',
    });
  });

  describe('SetupActivityService', () => {
    let service: SetupActivityService;

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config = {
          'worker.workerId': 'test-worker-id',
          'worker.workerConfigUrl': 'http://localhost:3000',
          'worker.baseWorkingPath': '/tmp',
          'keycloak': { workerSecret: 'test-secret' },
        };
        return config[key];
      }),
    };

    const mockRedisService = {
      getJobContext: jest.fn(),
      getJobState: jest.fn(),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    const mockProtocol = {
      mountPath: jest.fn(),
      unmountPath: jest.fn(),
    };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SetupActivityService,
          { provide: ConfigService, useValue: mockConfigService },
          { provide: RedisService, useValue: mockRedisService },
          { provide: Logger, useValue: mockLogger },
          { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
        ],
      }).compile();

      service = module.get<SetupActivityService>(SetupActivityService);

      jest.spyOn(Protocols, 'getProtocol').mockReturnValue(mockProtocol as any);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('setup', () => {
      it('should successfully set up the worker', async () => {
        const jobRunId = 'job-123';
        const mockContext = {
          jobConfig: {
            sourceFileServer: {
              hostname: 'source-host',
              username: 'user',
              password: 'pass',
              protocols: [{ type: 'NFS' }],
              protocolVersion: 'v1',
              path: '/source/path',
              pathId: 'source-id',
            },
            destinationFileServer: {
              hostname: 'dest-host',
              username: 'user',
              password: 'pass',
              protocols: [{ type: 'NFS' }],
              protocolVersion: 'v1',
              path: '/dest/path',
              pathId: 'dest-id',
            },
          },
        };

        // Mock the Redis service to return the context
        mockRedisService.getJobContext.mockResolvedValue(mockContext);

        mockProtocol.mountPath.mockResolvedValue({ status: 'success' });
        mockedAxios.post.mockResolvedValue({});

        const result = await service.setup(jobRunId);

        expect(mockRedisService.getJobContext).toHaveBeenCalledWith(jobRunId);
        expect(mockProtocol.mountPath).toHaveBeenCalledTimes(2);
        // expect(result).toEqual({
        //   jobRunId,
        //   status: 'success',
        //   protocolType: 'NFS',
        //   workerId: 'test-worker-id',
        //   message: 'Worker test-worker-id successfully set up.',
        // });
      });

      it('should return error if context is not found', async () => {
        const jobRunId = 'job-123';
        mockRedisService.getJobContext.mockResolvedValue(null);

        const result = await service.setup(jobRunId);

        expect(result).toEqual({
          jobRunId,
          status: 'error',
          workerId: 'test-worker-id',
          message: 'Setup failed: Context not found for traceId job-123',
        });
      });

      it('should return error if mountPath fails', async () => {
        const jobRunId = 'job-123';
        const mockContext = {
          jobConfig: {
            sourceFileServer: {
              hostname: 'source-host',
              username: 'user',
              password: 'pass',
              protocols: [{ type: 'NFS' }],
              protocolVersion: 'v1',
              path: '/source/path',
              pathId: 'source-id',
            },
          },
        };

        mockRedisService.getJobContext.mockResolvedValue(mockContext);
        mockProtocol.mountPath.mockRejectedValue(new Error('Mount failed'));

        const result = await service.setup(jobRunId);

        expect(result).toEqual({
          jobRunId,
          status: 'error',
          workerId: 'test-worker-id',
          message: 'Setup failed: Mount failed',
        });
      });
    });

    describe('cleanup', () => {
      it('should successfully clean up the worker', async () => {
        const jobRunId = 'job-123';
        const mockContext = {
          jobConfig: {
            sourceFileServer: {
              hostname: 'source-host',
              username: 'user',
              password: 'pass',
              protocols: [{ type: 'NFS' }],
              protocolVersion: 'v1',
              path: '/source/path',
              pathId: 'source-id',
            },
            destinationFileServer: {
              hostname: 'dest-host',
              username: 'user',
              password: 'pass',
              protocols: [{ type: 'NFS' }],
              protocolVersion: 'v1',
              path: '/dest/path',
              pathId: 'dest-id',
            },
          },
        };

        const mockJobState = { status: 'Completed' };

        // Mock the Redis service to return the context and job state
        mockRedisService.getJobContext.mockResolvedValue(mockContext);
        mockRedisService.getJobState.mockResolvedValue(mockJobState);

        mockProtocol.unmountPath.mockResolvedValue({ status: 'success' });

        const result = await service.cleanup(jobRunId);

        expect(mockRedisService.getJobContext).toHaveBeenCalledWith(jobRunId);
        expect(mockProtocol.unmountPath).toHaveBeenCalledTimes(2);
        expect(result).toEqual({
          jobRunId,
          status: 'success',
          protocolType: 'NFS',
          workerId: 'test-worker-id',
          message: 'Cleanup successful.',
        });
      });

      it('should return error if context is not found', async () => {
        const jobRunId = 'job-123';
        mockRedisService.getJobContext.mockResolvedValue(null);

        const result = await service.cleanup(jobRunId);

        expect(result).toEqual({
          jobRunId,
          status: 'error',
          workerId: 'test-worker-id',
          message: 'Cleanup failed: Context not found for traceId job-123',
        });
      });

      describe('SetupActivityService - Additional Tests', () => {
        let service: SetupActivityService;

        const mockConfigService = {
          get: jest.fn((key: string) => {
            const config = {
              'worker.workerId': 'test-worker-id',
              'worker.workerConfigUrl': 'http://localhost:3000',
              'worker.baseWorkingPath': '/tmp',
              'keycloak': { workerSecret: 'test-secret' },
            };
            return config[key];
          }),
        };

        const mockRedisService = {
          getJobContext: jest.fn(),
          getJobState: jest.fn(),
        };

        const mockLogger = {
          log: jest.fn(),
          error: jest.fn(),
        };

        const mockProtocol = {
          mountPath: jest.fn(),
          unmountPath: jest.fn(),
        };

        beforeEach(async () => {
          const module: TestingModule = await Test.createTestingModule({
            providers: [
              SetupActivityService,
              { provide: ConfigService, useValue: mockConfigService },
              { provide: RedisService, useValue: mockRedisService },
              { provide: Logger, useValue: mockLogger },
              { provide: Protocols, useValue: mockProtocol },
              { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), update: jest.fn(), patch: jest.fn(), put: jest.fn() } },
            ],
          }).compile();

          service = module.get<SetupActivityService>(SetupActivityService);

          jest
            .spyOn(Protocols, 'getProtocol')
            .mockReturnValue(mockProtocol as any);
        });

        afterEach(() => {
          jest.clearAllMocks();
        });

        describe('mountPath', () => {
          it('should call protocol.mountPath with correct parameters', async () => {
            const server = {
              hostname: 'test-host',
              username: 'user',
              password: 'pass',
              protocolVersion: 'v1',
              path: '/test/path',
              pathId: '123',
            };
            const jobRunId = 'job-123';

            await service.mountPath(
              server as any,
              mockProtocol as any,
              jobRunId,
            );

            expect(mockProtocol.mountPath).toHaveBeenCalledWith(jobRunId, {
              hostname: 'test-host',
              username: 'user',
              password: 'pass',
              protocolVersion: 'v1',
              path: '/test/path',
              mountBasePath: '/tmp',
              pathId: '123',
              jobRunId,
            });
          });
        });

        describe('unmountPath', () => {
          it('should call protocol.unmountPath with correct parameters', async () => {
            const server = {
              hostname: 'test-host',
              username: 'user',
              password: 'pass',
              protocolVersion: 'v1',
              path: '/test/path',
              pathId: '123',
            };
            const jobRunId = 'job-123';

            await service.unmountPath(
              server as any,
              mockProtocol as any,
              jobRunId,
            );

            expect(mockProtocol.unmountPath).toHaveBeenCalledWith(jobRunId, {
              hostname: 'test-host',
              username: 'user',
              password: 'pass',
              protocolVersion: 'v1',
              path: '/test/path',
              mountBasePath: '/tmp',
              pathId: '123',
              jobRunId,
            });
          });
        });

        describe('disconnectActiveSession', () => {
          it('should log success when session is disconnected', async () => {
            const payload = {
              traceId: 'trace-123',
              fileServer: {
                hostname: 'test-host',
                protocolType: 'NFS',
              },
            };

            const result = await service.disconnectActiveSession(payload);

            expect(mockLogger.log).toHaveBeenCalledWith(
              'trace-123',
              `[DisconnectActiveSession] Disconnecting active session for test-host`,
            );
            expect(result).toEqual({ response: 'success' });
          });

          it('should log error when session disconnection fails', async () => {
            const payload = {
              traceId: 'trace-123',
              fileServer: {
                hostname: 'test-host',
                protocolType: 'NFS',
              },
            };

            jest.spyOn(Protocols, 'getProtocol').mockImplementation(() => {
              throw new Error('Protocol error');
            });

            const result = await service.disconnectActiveSession(payload);

            expect(mockLogger.log).toHaveBeenCalledWith(
              'trace-123',
              `[DisconnectActiveSession] Error disconnecting session for test-host: Error: Protocol error`,
            );
            expect(result).toEqual({
              traceId: 'trace-123',
              status: 'error',
              workerId: undefined,
              message: `Error disconnecting session for test-host: Error: Protocol error`,
            });
          });
        });

        describe('cleanUpMountPath', () => {
          it('should call protocol.unmountPath and log success', async () => {
            const payload = {
              traceId: 'trace-123',
              fileServer: {
                hostname: 'test-host',
                protocolType: 'NFS',
              },
            };

            mockProtocol.unmountPath.mockResolvedValue({ status: 'success' });

            const result = await service.cleanUpMountPath(payload);

            expect(mockLogger.log).toHaveBeenCalledWith(
              'trace-123',
              `[cleanUp] Cleaning up for test-host`,
            );
            expect(mockLogger.log).toHaveBeenCalledWith(
              'trace-123',
              `[cleanUp] Cleaned up for test-host`,
            );
            expect(result).toEqual({ status: 'success' });
          });

          it('should log error when unmountPath fails', async () => {
            const payload = {
              traceId: 'trace-123',
              fileServer: {
                hostname: 'test-host',
                protocolType: 'NFS',
              },
            };

            mockProtocol.unmountPath.mockRejectedValue(
              new Error('Unmount error'),
            );

            const result = await service.cleanUpMountPath(payload);

            expect(mockLogger.log).toHaveBeenCalledWith(
              'trace-123',
              `[cleanUp] Error cleaning up for test-host: Error: Unmount error`,
            );
            expect(result).toEqual({
              traceId: 'trace-123',
              status: 'error',
              workerId: undefined,
              message: `Error cleaning up for test-host: Error: Unmount error`,
            });
          });

          describe('checkWritePermission', () => {
            const mockFs = {
              open: jest.fn(),
              close: jest.fn(),
              unlink: jest.fn(),
            };

            const mockUtil = {
              promisify: jest.fn((fn) => fn),
            };

            const mockProtocol = {
              unmountPath: jest.fn(),
            };

            beforeEach(() => {
              jest.spyOn(fs, 'open').mockImplementation(mockFs.open);
              jest.spyOn(fs, 'close').mockImplementation(mockFs.close);
              jest.spyOn(fs, 'unlink').mockImplementation(mockFs.unlink);
              jest
                .spyOn(util, 'promisify')
                .mockImplementation(mockUtil.promisify);
            });

            afterEach(() => {
              jest.clearAllMocks();
            });

            it('should return success when write permission check passes', async () => {
              const exportPathName = '/export/path';
              const pathId = '123';
              const traceId = 'trace-123';
              const mountBasePath = '/tmp';
              const hostname = 'test-host';
              const userName = 'user';
              const password = 'pass';
              const protocolVersion = 'v1';

              mockFs.open.mockImplementation((_, __, callback) =>
                callback(null, 1),
              );
              mockFs.close.mockResolvedValue(undefined);
              mockFs.unlink.mockResolvedValue(undefined);
              mockProtocol.unmountPath.mockResolvedValue(undefined);

              const result = await service.checkWritePermission(
                exportPathName,
                pathId,
                traceId,
                mountBasePath,
                hostname,
                userName,
                password,
                mockProtocol as any,
                'SOURCE',
                protocolVersion,
              );

              expect(mockProtocol.unmountPath).toHaveBeenCalledWith(traceId, {
                hostname,
                username: userName,
                password,
                path: exportPathName,
                mountBasePath,
                pathId,
                jobRunId: traceId,
                protocolVersion,
              });
              expect(result).toEqual({
                traceId,
                status: 'success',
                message: `Write permission check successful`,
              });
            });

            it('should return failure when file open fails', async () => {
              const exportPathName = '/export/path';
              const pathId = '123';
              const traceId = 'trace-123';
              const mountBasePath = '/tmp';
              const hostname = 'test-host';
              const userName = 'user';
              const password = 'pass';
              const protocolVersion = 'v1';

              mockFs.open.mockImplementation((_, __, callback) =>
                callback(new Error('Permission denied'), null),
              );

              const result = await service.checkWritePermission(
                exportPathName,
                pathId,
                traceId,
                mountBasePath,
                hostname,
                userName,
                password,
                mockProtocol as any,
                'SOURCE',
                protocolVersion,
              );

              expect(result).toEqual({
                traceId,
                status: 'failed',
                message: `Write permission check failed: Permission denied`,
              });
            });

            it('should handle errors during unmountPath', async () => {
              const exportPathName = '/export/path';
              const pathId = '123';
              const traceId = 'trace-123';
              const mountBasePath = '/tmp';
              const hostname = 'test-host';
              const userName = 'user';
              const password = 'pass';
              const protocolVersion = 'v1';

              mockFs.open.mockImplementation((_, __, callback) =>
                callback(null, 1),
              );
              mockFs.close.mockResolvedValue(undefined);
              mockFs.unlink.mockResolvedValue(undefined);
              mockProtocol.unmountPath.mockRejectedValue(
                new Error('Unmount failed'),
              );

              const result = await service.checkWritePermission(
                exportPathName,
                pathId,
                traceId,
                mountBasePath,
                hostname,
                userName,
                password,
                mockProtocol as any,
                'SOURCE',
                protocolVersion,
              );

              expect(result).toEqual({
                traceId,
                status: 'success',
                message: `Write permission check successful`,
              });
            });

            it('should handle errors during file deletion', async () => {
              const exportPathName = '/export/path';
              const pathId = '123';
              const traceId = 'trace-123';
              const mountBasePath = '/tmp';
              const hostname = 'test-host';
              const userName = 'user';
              const password = 'pass';
              const protocolVersion = 'v1';

              mockFs.open.mockImplementation((_, __, callback) =>
                callback(null, 1),
              );
              mockFs.close.mockResolvedValue(undefined);
              mockFs.unlink.mockRejectedValue(new Error('Delete failed'));
              mockProtocol.unmountPath.mockResolvedValue(undefined);

              const result = await service.checkWritePermission(
                exportPathName,
                pathId,
                traceId,
                mountBasePath,
                hostname,
                userName,
                password,
                mockProtocol as any,
                'SOURCE',
                protocolVersion,
              );

              expect(result).toEqual({
                traceId,
                status: 'success',
                message: `Write permission check successful`,
              });
            });
          });
        });
      });
    });
  });
});
