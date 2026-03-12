import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { MountTrackerService } from './mount-tracker.service';
import { MountRequest, ListDirsInput } from './jobconfig.types';
import { FileServerEntity } from '../entities/fileserver.entity';
import { Protocol } from 'src/constants/enums';
import * as path from 'path';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('util', () => {
  const fn = jest.fn();
  (global as any).__mockExecAsync = fn;
  return {
    ...jest.requireActual('util'),
    promisify: jest.fn(() => fn),
  };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue(''),
    rm: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('fast-glob', () => {
  const fn = jest.fn().mockResolvedValue([]);
  (global as any).__mockFg = fn;
  return { __esModule: true, default: fn };
});

jest.mock('dns', () => ({
  ...jest.requireActual('dns'),
  Resolver: jest.fn(),
  promises: {
    lookup: jest.fn(),
  },
}));

jest.mock('net', () => ({
  ...jest.requireActual('net'),
  isIP: jest.fn(),
}));

import * as dns from 'dns';
import * as fs from 'fs';
import * as net from 'net';

// Mutable ref for test stubbing (dns.Resolver and dns.promises.lookup are replaced in tests)
const dnsForTests = dns as unknown as {
  Resolver: jest.Mock;
  promises: { lookup: jest.Mock };
};

const mockExecAsync: jest.Mock = (global as any).__mockExecAsync;
const mockIsIP = net.isIP as jest.MockedFunction<typeof net.isIP>;

describe('MountTrackerService', () => {
  let service: MountTrackerService;
  let loggerService: jest.Mocked<LoggerService>;
  let loggerFactory: jest.Mocked<LoggerFactory>;

  const nfsRequest: MountRequest = {
    fileServerId: 'server-123',
    hostname: '192.168.1.100',
    exportPath: '/nfs/share',
    dir: 'subdir',
    protocol: Protocol.NFS,
  };

  const smbRequest: MountRequest = {
    fileServerId: 'server-456',
    hostname: '192.168.1.200',
    exportPath: '/smb/share',
    dir: '',
    protocol: Protocol.SMB,
    username: 'user',
    password: 'pass',
    protocolVersion: 'v3.0',
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    loggerService = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<LoggerService>;

    loggerFactory = {
      create: jest.fn().mockReturnValue(loggerService),
    } as unknown as jest.Mocked<LoggerFactory>;

    const configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'app.mount.basePath':
            return '/mnt';
          case 'app.mount.idleTimeoutMs':
            return 600000;
          case 'app.mount.timeoutMs':
            return 120000;
          case 'app.mount.backupuid':
            return 0;
          default:
            return undefined;
        }
      }),
    } as unknown as ConfigService;

    const mockFileServerRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MountTrackerService,
        { provide: LoggerFactory, useValue: loggerFactory },
        { provide: ConfigService, useValue: configService },
        {
          provide: getRepositoryToken(FileServerEntity),
          useValue: mockFileServerRepository,
        },
      ],
    }).compile();

    service = module.get<MountTrackerService>(MountTrackerService);
    mockExecAsync.mockReset();
    (fs.promises.mkdir as jest.Mock).mockReset().mockResolvedValue(undefined);
    (fs.promises.readdir as jest.Mock).mockReset().mockResolvedValue([]);
    (fs.promises.rm as jest.Mock).mockReset().mockResolvedValue(undefined);
    ((global as any).__mockFg as jest.Mock)?.mockReset?.();
    ((global as any).__mockFg as jest.Mock)?.mockResolvedValue?.([]);

    // Set up net.isIP mock behavior
    mockIsIP.mockImplementation((input: string) => {
      // Simple IP check for testing
      return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input) ? 4 : 0;
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('should initialize map from existing mounts under /mnt (no unmount)', async () => {
      const mountStdout =
        'sysfs on /sys type sysfs (rw)\n' +
        '192.168.1.1:/export on /mnt/abc/export type nfs (rw)\n' +
        'other on /var type tmpfs (rw)\n';
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd === 'mount')
          return Promise.resolve({ stdout: mountStdout, stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await service.onModuleInit();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'umount' && Array.isArray(call[1]),
      );
      expect(umountCalls).toHaveLength(0);
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('initializing map from existing mounts'),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('initialized map with 1 existing mount(s)'),
      );
      // ensureMounted for same path should hit the map and not call mount again
      mockExecAsync.mockClear();
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await service.ensureMounted({
        fileServerId: 'abc',
        hostname: '192.168.1.1',
        exportPath: 'export',
        dir: '',
        protocol: Protocol.NFS,
      });
      expect(result.mountPath).toBe('/mnt/abc/export');
      expect(result.key).toBe('abc:export:');
      const mountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'mount',
      );
      expect(mountCalls).toHaveLength(0);
    });

    it('should do nothing when no mounts under /mnt', async () => {
      mockExecAsync.mockResolvedValue({
        stdout:
          'sysfs on /sys type sysfs (rw)\n/dev/sda1 on / type ext4 (rw)\n',
        stderr: '',
      });

      await service.onModuleInit();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'umount' && Array.isArray(call[1]),
      );
      expect(umountCalls).toHaveLength(0);
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('initializing map from existing mounts'),
      );
    });

    it('should log warn and not throw when mount command fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('mount failed'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not read mount list for init'),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should unmount all tracked mounts', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);
      await service.ensureMounted(smbRequest);
      mockExecAsync.mockClear();
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.onModuleDestroy();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'umount' && Array.isArray(call[1]),
      );
      expect(umountCalls).toHaveLength(2);
    });

    it('should complete when no mounts are tracked', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockExecAsync).not.toHaveBeenCalledWith(
        'umount',
        expect.any(Array),
      );
    });
  });

  describe('ensureMounted', () => {
    it('should mount an NFS export and return mount details', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.ensureMounted(nfsRequest);

      expect(result.fileServerId).toBe(nfsRequest.fileServerId);
      expect(result.hostname).toBe(nfsRequest.hostname);
      expect(result.exportPath).toBe(nfsRequest.exportPath);
      expect(result.dir).toBe(nfsRequest.dir);
      expect(result.protocol).toBe(Protocol.NFS);
      expect(result.mountPath).toBe('/mnt/server-123/nfs/share/subdir');
      expect(result.key).toBe('server-123:nfs/share:subdir');
      expect(result.mountedAt).toBeDefined();
      expect(result.lastAccessAt).toBeDefined();
      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        '/mnt/server-123/nfs/share/subdir',
        { recursive: true },
      );
    });

    it('should mount an SMB share with credentials', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.ensureMounted(smbRequest);

      expect(result.fileServerId).toBe(smbRequest.fileServerId);
      expect(result.protocol).toBe(Protocol.SMB);
      expect(result.mountPath).toBe('/mnt/server-456/smb/share');
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([
          '-t',
          'cifs',
          expect.stringMatching(/^\/\/192\.168\.1\.200\/smb\/share/),
          expect.any(String),
          '-o',
          expect.stringMatching(/^credentials=\/.*\.cred,vers=/),
        ]),
        expect.any(Object),
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.cred$/),
        expect.stringContaining('username=user'),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it('should mount SMB as guest when no credentials provided', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const guestSmb: MountRequest = {
        ...smbRequest,
        username: undefined,
        password: undefined,
      };

      await service.ensureMounted(guestSmb);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('guest')]),
        expect.any(Object),
      );
    });

    it('should return existing mount without re-mounting', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const first = await service.ensureMounted(nfsRequest);
      mockExecAsync.mockClear();
      const second = await service.ensureMounted(nfsRequest);

      expect(second.key).toBe(first.key);
      expect(second.mountPath).toBe(first.mountPath);
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('should deduplicate concurrent mount requests for the same key', async () => {
      let resolveMount!: () => void;
      const mountPromise = new Promise<void>((resolve) => {
        resolveMount = resolve;
      });
      mockExecAsync.mockImplementation(() =>
        mountPromise.then(() => ({ stdout: '', stderr: '' })),
      );

      const promise1 = service.ensureMounted(nfsRequest);
      const promise2 = service.ensureMounted(nfsRequest);

      resolveMount();
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.key).toBe(result2.key);
      expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
    });

    it('should throw if mount command fails', async () => {
      mockExecAsync.mockRejectedValue(
        new Error('mount.nfs: Connection refused'),
      );

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'mount.nfs: Connection refused',
      );
    });

    it('should throw for unsupported protocol', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        protocol: 'FTP' as Protocol,
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow(
        'Unsupported protocol: FTP',
      );
    });

    it('should throw for invalid path segment (..) in fileServerId', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        fileServerId: '..',
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow(
        'Invalid path segment',
      );
    });

    it('should throw for path segment with .. in dir', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        dir: '..',
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow(
        'Invalid path segment',
      );
    });

    it('should throw when resolved mount path is outside MOUNT_BASE', async () => {
      const realResolve = path.resolve.bind(path);
      const pathResolveSpy = jest
        .spyOn(path, 'resolve')
        .mockImplementation((...args: string[]) => {
          const arg = args[0];
          if (
            typeof arg === 'string' &&
            arg.includes('server-123') &&
            arg.startsWith('/mnt')
          ) {
            return '/tmp/outside-mount-base';
          }
          return realResolve(...args);
        });
      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'Mount path must stay under /mnt',
      );
      pathResolveSpy.mockRestore();
    });

    it('should not include timeoutHandle in returned MountDetails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.ensureMounted(nfsRequest);

      expect((result as any).timeoutHandle).toBeUndefined();
    });
  });

  describe('listDirectoriesls (fs.readdir)', () => {
    const input: ListDirsInput = {
      mountPath: '/mnt/server-123/nfs/share',
      path: 'subdir',
    };

    it('should return directory entries', async () => {
      const mockEntries = [
        {
          name: 'dir1',
          isDirectory: () => true,
          parentPath: '/mnt/server-123/nfs/share/subdir',
        },
        {
          name: 'file1.txt',
          isDirectory: () => false,
          parentPath: '/mnt/server-123/nfs/share/subdir',
        },
        {
          name: 'dir2',
          isDirectory: () => true,
          parentPath: '/mnt/server-123/nfs/share/subdir',
        },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectoriesls(input);

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.name)).toEqual(
        expect.arrayContaining(['dir1', 'dir2']),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 directories'),
      );
    });

    it('should list directories after SMB mount when backupuid is 0', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mountResult = await service.ensureMounted(smbRequest);
      expect(mountResult.mountPath).toBe('/mnt/server-456/smb/share');
      const mountCalls = mockExecAsync.mock.calls.filter(
        (c: unknown[]) =>
          Array.isArray(c[1]) &&
          c[1].some(
            (arg: unknown) =>
              typeof arg === 'string' && arg.includes('backupuid=0'),
          ),
      );
      expect(mountCalls.length).toBeGreaterThan(0);

      const mockEntries = [
        {
          name: 'dir1',
          isDirectory: () => true,
          parentPath: mountResult.mountPath,
        },
        {
          name: 'dir2',
          isDirectory: () => true,
          parentPath: mountResult.mountPath,
        },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const listResult = await service.listDirectoriesls({
        mountPath: mountResult.mountPath,
        path: '.',
      });

      expect(listResult).toHaveLength(2);
      expect(listResult.map((d) => d.name)).toEqual(
        expect.arrayContaining(['dir1', 'dir2']),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 directories'),
      );
    });

    it('should return empty array when no directories exist', async () => {
      const mockEntries = [{ name: 'file1.txt', isDirectory: () => false }];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectoriesls(input);

      expect(result).toEqual([]);
    });

    it('should return empty array on ENOENT', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      const result = await service.listDirectoriesls(input);

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Directory not found'),
      );
    });

    it('should return empty array on "No such file" error', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(
        new Error('No such file or directory'),
      );

      const result = await service.listDirectoriesls(input);

      expect(result).toEqual([]);
    });

    it('should throw on unexpected errors', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(service.listDirectoriesls(input)).rejects.toThrow(
        'Permission denied',
      );
      expect(loggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('Error listing directories'),
      );
    });

    it('should normalize double slashes in path', async () => {
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);

      await service.listDirectoriesls({
        mountPath: '/mnt/server/',
        path: '/subdir',
      });

      expect(fs.promises.readdir).toHaveBeenCalledWith(
        '/mnt/server/subdir',
        expect.any(Object),
      );
    });

    it('should return empty array when path traversal is rejected', async () => {
      const result = await service.listDirectoriesls({
        mountPath: '/mnt/safe',
        path: '../../../etc',
      });

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Path traversal rejected in listDirectoriesls',
      );
    });

    it('should return empty array when normalized path fails second sanitize check', async () => {
      const realNormalize = path.normalize.bind(path);
      const pathNormalizeSpy = jest
        .spyOn(path, 'normalize')
        .mockImplementation((p: string) => {
          if (p === 'x' || p.includes('x')) return '..';
          return realNormalize(p);
        });
      const result = await service.listDirectoriesls({
        mountPath: '/mnt/base',
        path: 'x',
      });
      pathNormalizeSpy.mockRestore();
      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Path traversal rejected in listDirectoriesls',
      );
    });

    it('should return directory names from Dirent.name (no parentPath/path)', async () => {
      const mockEntries = [{ name: 'dir1', isDirectory: () => true }];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectoriesls(input);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('dir1');
    });

    it('should return empty array when resolved path is outside base (in-function guard)', async () => {
      const realResolve = path.resolve.bind(path);
      const pathResolveSpy = jest
        .spyOn(path, 'resolve')
        .mockImplementation((...args: string[]) => {
          const resolved = realResolve(...args);
          if (resolved.includes('subdir') && args.length === 1) {
            return '/tmp/outside-path';
          }
          return resolved;
        });
      const result = await service.listDirectoriesls({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });
      pathResolveSpy.mockRestore();
      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Path traversal rejected in listDirectoriesls',
      );
    });
  });

  describe('listDirectoriesFastGlob', () => {
    const getMockFg = () => (global as any).__mockFg as jest.Mock | undefined;

    it('should return empty array when path traversal is rejected', async () => {
      const result = await service.listDirectoriesFastGlob({
        mountPath: '/mnt/safe',
        path: '../../../etc',
      });

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Path traversal rejected in listDirectoriesFastGlob',
      );
    });

    it('should return directory names from fast-glob entries', async () => {
      getMockFg().mockResolvedValue([
        '/mnt/server-123/nfs/share/subdir/d1',
        '/mnt/server-123/nfs/share/subdir/d2',
      ]);

      const result = await service.listDirectoriesFastGlob({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.name).sort()).toEqual(['d1', 'd2']);
    });

    it('should return empty array on ENOENT', async () => {
      getMockFg().mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
      );

      const result = await service.listDirectoriesFastGlob({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Directory not found'),
      );
    });

    it('should throw on unexpected errors', async () => {
      getMockFg().mockRejectedValue(new Error('Unexpected glob error'));

      await expect(
        service.listDirectoriesFastGlob({
          mountPath: '/mnt/server-123/nfs/share',
          path: 'subdir',
        }),
      ).rejects.toThrow('Unexpected glob error');
      expect(loggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('Error listing directories'),
      );
    });

    it('should return empty array when fullPath is outside base (in-function guard)', async () => {
      const realResolve = path.resolve.bind(path);
      let callCount = 0;
      const pathResolveSpy = jest
        .spyOn(path, 'resolve')
        .mockImplementation((...args: string[]) => {
          callCount += 1;
          if (callCount === 2 && args[0]?.includes('subdir')) {
            return '/tmp/outside-fastglob';
          }
          return realResolve(...args);
        });
      const result = await service.listDirectoriesFastGlob({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });
      pathResolveSpy.mockRestore();
      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(
        'Path traversal rejected in listDirectoriesFastGlob',
      );
    });
  });

  describe('touch', () => {
    it('should update lastAccessAt for an existing mount', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mounted = await service.ensureMounted(nfsRequest);

      const beforeTouch = mounted.lastAccessAt;
      jest.advanceTimersByTime(1000);
      await service.touch(mounted.key);

      const updated = await service.ensureMounted(nfsRequest);
      expect(updated.lastAccessAt).toBeGreaterThanOrEqual(beforeTouch);
    });

    it('should do nothing for a non-existent key', async () => {
      await expect(service.touch('non-existent-key')).resolves.toBeUndefined();
    });
  });

  describe('unmount', () => {
    it('should unmount and clean up mount directory', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mounted = await service.ensureMounted(nfsRequest);
      mockExecAsync.mockClear();
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.unmount(mounted.key);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'umount',
        [mounted.mountPath],
        expect.objectContaining({ timeout: 30000 }),
      );
      expect(fs.promises.rm).toHaveBeenCalledWith(mounted.mountPath, {
        recursive: true,
        force: true,
      });
    });

    it('should do nothing for a non-existent key', async () => {
      await expect(service.unmount('non-existent')).resolves.toBeUndefined();
      expect(mockExecAsync).not.toHaveBeenCalled();
    });

    it('should clear the idle timeout on unmount', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      const mounted = await service.ensureMounted(nfsRequest);
      await service.unmount(mounted.key);

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('unmountAll', () => {
    it('should unmount all active mounts', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);
      await service.ensureMounted(smbRequest);
      mockExecAsync.mockClear();
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.unmountAll();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'umount' && Array.isArray(call[1]),
      );
      expect(umountCalls).toHaveLength(2);
    });

    it('should handle empty mounts gracefully', async () => {
      await expect(service.unmountAll()).resolves.toBeUndefined();
    });
  });

  describe('idle timeout unmount', () => {
    it('should auto-unmount after idle timeout', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);
      mockExecAsync.mockClear();
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Spy on the private unmountIfIdle so we can await its promise
      const unmountIfIdleSpy = jest.spyOn(service as any, 'unmountIfIdle');

      jest.advanceTimersByTime(10 * 60 * 1000 + 1);

      // Wait for the async unmountIfIdle chain to resolve
      await unmountIfIdleSpy.mock.results[0]?.value;

      expect(mockExecAsync).toHaveBeenCalledWith(
        'umount',
        expect.any(Array),
        expect.objectContaining({ timeout: 30000 }),
      );

      unmountIfIdleSpy.mockRestore();
    });

    it('should reschedule if touched before timeout', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const mounted = await service.ensureMounted(nfsRequest);

      jest.advanceTimersByTime(5 * 60 * 1000);
      await service.touch(mounted.key);

      mockExecAsync.mockClear();

      const unmountIfIdleSpy = jest.spyOn(service as any, 'unmountIfIdle');

      jest.advanceTimersByTime(5 * 60 * 1000);

      // Wait for the reschedule path to complete
      await unmountIfIdleSpy.mock.results[0]?.value;

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => call[0] === 'umount' && Array.isArray(call[1]),
      );
      expect(umountCalls).toHaveLength(0);

      unmountIfIdleSpy.mockRestore();
    });

    it('should log and not rethrow when performUnmount fails during idle unmount', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);
      mockExecAsync.mockClear();

      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd === 'umount') {
          return Promise.reject(new Error('umount failed'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const unmountIfIdleSpy = jest.spyOn(service as any, 'unmountIfIdle');
      jest.advanceTimersByTime(10 * 60 * 1000 + 1);

      await unmountIfIdleSpy.mock.results[0]?.value;

      expect(loggerService.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to unmount'),
      );
      unmountIfIdleSpy.mockRestore();
    });

    it('should reschedule unmount when unmountIfIdle is called but mount was recently touched', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mounted = await service.ensureMounted(nfsRequest);
      await service.touch(mounted.key);
      mockExecAsync.mockClear();

      await (service as any).unmountIfIdle(mounted.key);

      expect(mockExecAsync).not.toHaveBeenCalledWith(
        'umount',
        expect.any(Array),
      );
    });
  });

  describe('ensureMounted – mount timeout handling', () => {
    it('should throw HttpException on ETIMEDOUT error', async () => {
      const etimedoutErr = new Error(
        'connect ETIMEDOUT',
      ) as NodeJS.ErrnoException;
      etimedoutErr.code = 'ETIMEDOUT';
      mockExecAsync.mockRejectedValue(etimedoutErr);

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'Mount timed out after 2 minutes',
      );
    });

    it('should throw HttpException when mount process is killed (timeout)', async () => {
      const killedErr: any = new Error('killed');
      killedErr.killed = true;
      mockExecAsync.mockRejectedValue(killedErr);

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'Mount timed out after 2 minutes',
      );
    });

    it('should throw HttpException when error message contains "timeout"', async () => {
      mockExecAsync.mockRejectedValue(new Error('operation Timeout exceeded'));

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'Mount timed out after 2 minutes',
      );
    });

    it('should wrap non-Error throw from mount as string', async () => {
      mockExecAsync.mockRejectedValue('raw string error');

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        /Mount failed for/,
      );
    });

    it('should wrap null/undefined throw from mount as "Mount failed"', async () => {
      mockExecAsync.mockRejectedValue(null);

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'Mount failed',
      );
    });

    it('should clean up SMB credentials file even when mount fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('mount failed'));

      await expect(service.ensureMounted(smbRequest)).rejects.toThrow(
        /Mount failed for/,
      );

      expect(fs.promises.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/\.cred$/),
      );
    });
  });

  describe('onModuleInit – edge cases', () => {
    it('should initialize map when mount list has one entry (no umount or rm on init)', async () => {
      const mountStdout =
        '192.168.1.1:/export on /mnt/abc/export type nfs (rw)\n';
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd === 'mount')
          return Promise.resolve({ stdout: mountStdout, stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockExecAsync).not.toHaveBeenCalledWith(
        'umount',
        expect.any(Array),
      );
      expect(fs.promises.rm).not.toHaveBeenCalled();
    });

    it('should handle non-Error object thrown when reading mount list', async () => {
      mockExecAsync.mockRejectedValue('non-error-object');

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not read mount list for init'),
      );
    });
  });

  describe('ensureMounted – path validation edge cases', () => {
    it('should throw for absolute path in exportPath after stripping', async () => {
      // exportPath that after replace still has absolute characteristics
      const badRequest: MountRequest = {
        ...nfsRequest,
        exportPath: '/../escape',
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow(
        'Invalid path segment',
      );
    });
  });

  describe('listDirectoriesls – edge cases', () => {
    it('should handle undefined path (defaults to ".")', async () => {
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.listDirectoriesls({
        mountPath: '/mnt/server',
        path: undefined as any,
      });

      expect(result).toEqual([]);
    });

    it('should handle non-Error thrown in readdir', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue('string error');

      await expect(
        service.listDirectoriesls({ mountPath: '/mnt/server', path: '.' }),
      ).rejects.toBe('string error');
    });
  });

  describe('listDirectoriesFastGlob – edge cases', () => {
    it('should handle "No such file" error', async () => {
      const getMockFg = () => (global as any).__mockFg as jest.Mock;
      getMockFg().mockRejectedValue(new Error('No such file or directory'));

      const result = await service.listDirectoriesFastGlob({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });

      expect(result).toEqual([]);
    });

    it('should handle non-Error thrown in fast-glob', async () => {
      const getMockFg = () => (global as any).__mockFg as jest.Mock;
      getMockFg().mockRejectedValue('string error from fg');

      await expect(
        service.listDirectoriesFastGlob({
          mountPath: '/mnt/server-123/nfs/share',
          path: 'subdir',
        }),
      ).rejects.toBe('string error from fg');
    });
  });

  describe('buildMountArgs (via ensureMounted)', () => {
    it('should build correct NFS mount args for execFile', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        [
          '-t',
          'nfs',
          '-o',
          'nolock',
          '192.168.1.100:/nfs/share',
          '/mnt/server-123/nfs/share/subdir',
        ],
        expect.any(Object),
      );
    });

    it('should build correct SMB mount args with version stripped of v prefix', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const smbWithVPrefix: MountRequest = {
        ...smbRequest,
        protocolVersion: 'V2.1',
      };

      await service.ensureMounted(smbWithVPrefix);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining(['-o', expect.stringContaining('vers=2.1')]),
        expect.any(Object),
      );
    });

    it('should default SMB version to 3.0 when not provided', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const smbNoVersion: MountRequest = {
        ...smbRequest,
        protocolVersion: undefined,
      };

      await service.ensureMounted(smbNoVersion);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining(['-o', expect.stringContaining('vers=3.0')]),
        expect.any(Object),
      );
    });

    it('should normalize backslashes in SMB export path', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const smbBackslash: MountRequest = {
        ...smbRequest,
        fileServerId: 'server-789',
        exportPath: '\\smb\\share',
      };

      await service.ensureMounted(smbBackslash);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([
          expect.stringMatching(/^\/\/192\.168\.1\.200\/smb\/share/),
        ]),
        expect.any(Object),
      );
    });
  });

  describe('DNS resolution functionality', () => {
    let mockFileServerRepository: any;

    beforeEach(() => {
      mockFileServerRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };

      // Replace the existing mock with our new one
      const module = ((service as any).fileServerRepository =
        mockFileServerRepository);
    });

    it('should use hostname directly when it is already an IP address', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const ipRequest: MountRequest = {
        ...smbRequest,
        hostname: '10.0.0.100', // Already an IP
        fileServerId: 'test-server',
      };

      await service.ensureMounted(ipRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.100/')]),
        expect.any(Object),
      );
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('is already an IP address'),
      );
    });

    it('should use custom DNS servers from FileServer configuration', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10,192.168.1.11',
      });

      // Mock DNS resolution
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.200']);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockFileServerRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-server' },
        select: ['dnsServer'],
      });
      expect(dnsMock.setServers).toHaveBeenCalledWith([
        '192.168.1.10',
        '192.168.1.11',
      ]);

      // Restore original
      dnsForTests.Resolver = originalResolver;
    });

    it('should fallback to system DNS when custom DNS fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      // Mock DNS resolution - custom fails, system succeeds
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(new Error('Custom DNS failed'), null);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      // Mock system DNS to succeed
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockResolvedValue({ address: '10.0.0.201' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost2',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.201/')]),
        expect.any(Object),
      );

      // Restore originals
      dnsForTests.Resolver = originalResolver;
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should try FQDN resolution for short hostnames when custom DNS fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      let callCount = 0;
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callCount++;
          if (callCount === 1 && hostname === 'shortname') {
            // First call (shortname) fails
            callback(new Error('Not found'), null);
          } else if (
            callCount === 2 &&
            hostname === 'shortname.rootdomain.local'
          ) {
            // Second call (FQDN) succeeds
            callback(null, ['10.0.0.202']);
          } else {
            callback(new Error('Unexpected call'), null);
          }
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'shortname', // No dots - should trigger FQDN attempt
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(dnsMock.resolve4).toHaveBeenCalledWith(
        'shortname',
        expect.any(Function),
      );
      expect(dnsMock.resolve4).toHaveBeenCalledWith(
        'shortname.rootdomain.local',
        expect.any(Function),
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.202/')]),
        expect.any(Object),
      );

      // Restore original
      dnsForTests.Resolver = originalResolver;
    });

    it('should fallback to original hostname when all DNS strategies fail', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      // Mock DNS resolution to always fail
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(new Error('DNS failed'), null);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      // Mock system DNS to also fail
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'failhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//failhost/')]), // Should use original hostname
        expect.any(Object),
      );
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'All DNS resolution strategies failed for failhost',
        ),
      );

      // Restore originals
      dnsForTests.Resolver = originalResolver;
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should handle FileServer repository errors gracefully', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer repository to throw error
      mockFileServerRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );

      // Mock system DNS to succeed
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockResolvedValue({ address: '10.0.0.203' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost3',
        fileServerId: 'error-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Failed to get DNS servers from FileServer error-server',
        ),
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.203/')]),
        expect.any(Object),
      );

      // Restore original
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should handle empty DNS servers configuration', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with empty dnsServer
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '',
      });

      // Mock system DNS to succeed
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockResolvedValue({ address: '10.0.0.204' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost4',
        fileServerId: 'empty-dns-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.204/')]),
        expect.any(Object),
      );

      // Restore original
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should use cached resolved IP for subsequent mounts with same key', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with DNS servers to trigger resolution logic
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      // Mock DNS resolution to track how many times it's called
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.205']);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'cachetest', // Use hostname to trigger DNS resolution
        fileServerId: 'cache-test',
      };

      // First mount - should resolve DNS and mount
      const result1 = await service.ensureMounted(hostnameRequest);

      // Verify DNS resolution happened
      expect(dnsMock.resolve4).toHaveBeenCalledTimes(1);
      expect(result1.key).toBe('cache-test:smb/share:');

      // Clear the DNS mock call count but don't unmount
      dnsMock.resolve4.mockClear();

      // Call resolveHostToIp directly (simulates what happens during mount creation)
      // This should use the cached IP from the existing mount
      const resolvedIp = await (service as any).resolveHostToIp(
        'cachetest',
        '/share',
        result1.key,
        'cache-test',
      );

      expect(resolvedIp).toBe('10.0.0.205');

      // Should not perform DNS resolution again (IP was cached in the mount record)
      expect(dnsMock.resolve4).not.toHaveBeenCalled();

      // Restore original
      dnsForTests.Resolver = originalResolver;
    });

    it('should cache IP in existing mount record during resolution', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      // Mock DNS resolution
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.206']);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testcache',
        fileServerId: 'cache-test-2',
      };

      // First mount - creates mount record with resolved IP
      const result = await service.ensureMounted(hostnameRequest);

      // Verify the mount record has the resolved IP stored
      const mountRecord = (service as any).mounts.get(result.key);
      expect(mountRecord.resolvedIp).toBe('10.0.0.206');

      // Verify caching log was written
      expect(loggerService.log).toHaveBeenCalledWith(
        expect.stringContaining('Using IP 10.0.0.206 for CIFS mount'),
      );

      // Restore original
      dnsForTests.Resolver = originalResolver;
    });

    it('should try individual DNS servers when custom resolver fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with multiple DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10,192.168.1.11,192.168.1.12',
      });

      let resolveCallCount = 0;
      const createMockResolver = () => ({
        resolve4: jest.fn((hostname, callback) => {
          resolveCallCount++;
          if (resolveCallCount <= 2) {
            // First resolver and system DNS fail
            callback(new Error('DNS failed'), null);
          } else if (resolveCallCount === 3 && hostname === 'testhost5') {
            // Third individual server succeeds
            callback(null, ['10.0.0.206']);
          } else {
            callback(new Error('Unexpected'), null);
          }
        }),
        setServers: jest.fn(),
      });

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => createMockResolver());
      dnsForTests.Resolver = mockResolver;

      // Mock system DNS to fail
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost5',
        fileServerId: 'multi-dns-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.206/')]),
        expect.any(Object),
      );

      // Restore originals
      dnsForTests.Resolver = originalResolver;
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should handle system DNS usage when no fileServerId provided', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock system DNS to succeed
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockResolvedValue({ address: '10.0.0.207' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'nofileserver',
        fileServerId: undefined, // No fileServerId
      };

      await service.ensureMounted(hostnameRequest);

      // Should not attempt to query repository
      expect(mockFileServerRepository.findOne).not.toHaveBeenCalled();
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//10.0.0.207/')]),
        expect.any(Object),
      );

      // Restore original
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should disable DNS resolution for SMB mounts when config is false', async () => {
      // Create a new service instance with DNS resolution disabled
      const disabledConfigService = {
        get: jest.fn((key: string) => {
          switch (key) {
            case 'app.mount.basePath':
              return '/mnt';
            case 'app.mount.idleTimeoutMs':
              return 600000;
            case 'app.mount.timeoutMs':
              return 120000;
            case 'app.mount.resolveCifsHostnameToIp':
              return false; // Disable DNS resolution
            default:
              return undefined;
          }
        }),
      } as unknown as ConfigService;

      const mockFileServerRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };

      const disabledModule: TestingModule = await Test.createTestingModule({
        providers: [
          MountTrackerService,
          { provide: LoggerFactory, useValue: loggerFactory },
          { provide: ConfigService, useValue: disabledConfigService },
          {
            provide: getRepositoryToken(FileServerEntity),
            useValue: mockFileServerRepository,
          },
        ],
      }).compile();

      const disabledService =
        disabledModule.get<MountTrackerService>(MountTrackerService);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const smbHostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'smb-hostname', // Use hostname instead of IP
        fileServerId: 'test-server',
      };

      await disabledService.ensureMounted(smbHostnameRequest);

      // Should use original hostname without DNS resolution
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//smb-hostname/')]),
        expect.any(Object),
      );

      // Should not attempt to query FileServer repository for DNS servers
      expect(mockFileServerRepository.findOne).not.toHaveBeenCalled();
    });

    it('should handle FQDN resolution failure gracefully', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          // All DNS resolution attempts fail
          callback(new Error('DNS resolution failed'), null);
        }),
        setServers: jest.fn(),
      };

      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      dnsForTests.Resolver = mockResolver;

      // Mock system DNS to also fail
      const originalLookup = dnsForTests.promises.lookup;
      dnsForTests.promises.lookup = jest
        .fn()
        .mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'short', // Should trigger FQDN attempt
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      // Should try both short name and FQDN
      expect(dnsMock.resolve4).toHaveBeenCalledWith(
        'short',
        expect.any(Function),
      );
      expect(dnsMock.resolve4).toHaveBeenCalledWith(
        'short.rootdomain.local',
        expect.any(Function),
      );

      // Should fallback to original hostname
      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//short/')]),
        expect.any(Object),
      );

      // Restore originals
      dnsForTests.Resolver = originalResolver;
      dnsForTests.promises.lookup = originalLookup;
    });

    it('should handle non-Error objects in DNS resolution', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10',
      });

      // Mock DNS resolution to throw non-Error object
      const originalResolver = dnsForTests.Resolver;
      const mockResolver = jest.fn(() => {
        throw new Error('string error'); // Non-Error object
      });
      dnsForTests.Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'errorhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount',
        expect.arrayContaining([expect.stringContaining('//errorhost/')]), // Should use original hostname
        expect.any(Object),
      );
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('DNS resolution error for errorhost'),
      );

      // Restore original
      dnsForTests.Resolver = originalResolver;
    });
  });
});
