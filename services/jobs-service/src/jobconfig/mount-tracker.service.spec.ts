import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { MountTrackerService } from './mount-tracker.service';
import { MountRequest, ListDirsInput } from './jobconfig.types';
import { FileServerEntity } from '../entities/fileserver.entity';
import { Protocol } from 'src/constants/enums';
import * as path from 'path';

jest.mock('child_process', () => {
  const { EventEmitter } = require('events');
  const { Readable, Writable } = require('stream');
  const createMockSpawn = () => {
    const child = new EventEmitter();
    child.stdin = new Writable({ write(_chunk: any, _enc: any, cb: any) { cb(); } });
    child.stdout = new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    // Emit close after a microtask delay so listeners are registered first
    Promise.resolve().then(() => {
      child.emit('close', (global as any).__mockSpawnExitCode ?? 0);
    });
    return child;
  };
  return {
    execFile: jest.fn(),
    exec: jest.fn(),
    spawn: jest.fn(createMockSpawn),
  };
});

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
    lstat: jest.fn().mockImplementation(() =>
      Promise.resolve({
        dev: 1,
        ino: 1,
        isDirectory: () => true,
        isSymbolicLink: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      }),
    ),
    stat: jest.fn().mockImplementation(() =>
      Promise.resolve({
        dev: 1,
        ino: 1,
        isDirectory: () => true,
      }),
    ),
    writeFile: jest.fn().mockResolvedValue(undefined),
    appendFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('dns', () => ({
  ...jest.requireActual('dns'),
  Resolver: jest.fn().mockImplementation(() => ({
    setServers: jest.fn(),
    resolve4: jest.fn((_hostname: string, callback: Function) => {
      callback(new Error('DNS not available'), null);
    }),
  })),
  promises: {
    lookup: jest.fn()
  }
}));

jest.mock('net', () => ({
  ...jest.requireActual('net'),
  isIP: jest.fn()
}));

import * as fs from 'fs';
import * as net from 'net';

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
        { provide: getRepositoryToken(FileServerEntity), useValue: mockFileServerRepository },
      ],
    }).compile();

    service = module.get<MountTrackerService>(MountTrackerService);
    mockExecAsync.mockReset();
    (global as any).__mockSpawnExitCode = 0; // kinit spawn succeeds by default
    (fs.promises.mkdir as jest.Mock).mockReset().mockResolvedValue(undefined);
    (fs.promises.readdir as jest.Mock).mockReset().mockResolvedValue([]);
    (fs.promises.readFile as jest.Mock).mockReset().mockResolvedValue('');
    (fs.promises.appendFile as jest.Mock).mockReset().mockResolvedValue(undefined);
    (fs.promises.writeFile as jest.Mock).mockReset().mockResolvedValue(undefined);
    (fs.promises.rm as jest.Mock).mockReset().mockResolvedValue(undefined);

    // dns.promises.lookup should reject by default so ensureHostsEntry doesn't hang
    const dns = require('dns');
    (dns.promises.lookup as jest.Mock).mockReset().mockRejectedValue(new Error('DNS not available'));

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
        if (cmd === 'mount') return Promise.resolve({ stdout: mountStdout, stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await service.onModuleInit();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('umount'),
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
      const mountCalls = mockExecAsync.mock.calls.filter((call: any[]) => call[0] === 'mount');
      expect(mountCalls).toHaveLength(0);
    });

    it('should do nothing when no mounts under /mnt', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: 'sysfs on /sys type sysfs (rw)\n/dev/sda1 on / type ext4 (rw)\n',
        stderr: '',
      });

      await service.onModuleInit();

      const umountCalls = mockExecAsync.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('umount'),
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
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('umount'),
      );
      expect(umountCalls).toHaveLength(2);
    });

    it('should complete when no mounts are tracked', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockExecAsync.mock.calls.some((c: any[]) => c[0] && String(c[0]).includes('umount'))).toBe(false);
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
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/mnt/server-123/nfs/share/subdir', { recursive: true });
    });

    it('should mount an SMB share with credentials', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await service.ensureMounted(smbRequest);

      expect(result.fileServerId).toBe(smbRequest.fileServerId);
      expect(result.protocol).toBe(Protocol.SMB);
      expect(result.mountPath).toBe('/mnt/server-456/smb/share');
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringMatching(/mount -t cifs.*\$\{HOST\}\/\$\{SHARE_PATH\}.*\$\{DIR_PATH\}/),
        expect.objectContaining({
          env: expect.objectContaining({
            HOST: '192.168.1.200',
            SHARE_PATH: 'smb/share',
            DIR_PATH: '/mnt/server-456/smb/share',
            USERNAME: 'user',
            PASSWORD: 'pass',
          }),
        })
      );
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.cred$/),
        expect.stringContaining('username=user'),
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should mount SMB with credentials file (guest user when no credentials provided)', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const guestSmb: MountRequest = {
        ...smbRequest,
        username: undefined,
        password: undefined,
      };

      await service.ensureMounted(guestSmb);

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.cred$/),
        expect.stringContaining('username=guest'),
        expect.objectContaining({ mode: 0o600 })
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringMatching(/credentials=.*vers=\$\{VERS\}/),
        expect.objectContaining({
          env: expect.objectContaining({
            HOST: '192.168.1.200',
            SHARE_PATH: 'smb/share',
            CREDENTIALS_FILE: expect.stringMatching(/\.cred$/),
          }),
        })
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
      const mountPromise = new Promise<void>((resolve) => { resolveMount = resolve; });
      mockExecAsync.mockImplementation(() =>
        mountPromise.then(() => ({ stdout: '', stderr: '' }))
      );

      const promise1 = service.ensureMounted(nfsRequest);
      const promise2 = service.ensureMounted(nfsRequest);

      resolveMount();
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.key).toBe(result2.key);
      expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
    });

    it('should throw if mount command fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('mount.nfs: Connection refused'));

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(
        'mount.nfs: Connection refused',
      );
    });

    it('should throw for unsupported protocol', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        protocol: 'FTP' as Protocol,
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow('Unsupported protocol: FTP');
    });

    it('should throw for invalid path segment (..) in fileServerId', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        fileServerId: '..',
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow('Invalid path segment');
    });

    it('should throw for path segment with .. in dir', async () => {
      const badRequest: MountRequest = {
        ...nfsRequest,
        dir: '..',
      };

      await expect(service.ensureMounted(badRequest)).rejects.toThrow('Invalid path segment');
    });

    it('should throw when resolved mount path is outside MOUNT_BASE', async () => {
      const realResolve = path.resolve.bind(path);
      const pathResolveSpy = jest.spyOn(path, 'resolve').mockImplementation((...args: string[]) => {
        const arg = args[0];
        if (typeof arg === 'string' && arg.includes('server-123') && arg.startsWith('/mnt')) {
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

    describe('Kerberos fallback', () => {
      it('should retry with Kerberos (sec=krb5) when NTLM mount fails', async () => {
        const fqdnRequest: MountRequest = {
          ...smbRequest,
          hostname: 'smb-server.domain.local',
          fileServerId: 'server-789',
        };

        // performDnsResolution needs dns.promises.lookup to resolve the FQDN to an IP
        const dns = require('dns');
        (dns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.0.0.99', family: 4 });

        // First call (NTLM) fails, second call (Kerberos mount) succeeds
        mockExecAsync
          .mockRejectedValueOnce(new Error('mount: mounting //10.0.0.99/smb/share on /mnt/server-789/smb/share failed: Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.ensureMounted(fqdnRequest);

        expect(result.protocol).toBe(Protocol.SMB);
        expect(result.mountPath).toBe('/mnt/server-789/smb/share');
        // Second exec call should use the Kerberos command with sec=krb5
        const krbCall = mockExecAsync.mock.calls.find((c: any[]) => String(c[0]).includes('sec=krb5'));
        expect(krbCall).toBeDefined();
        expect(krbCall[1].env.HOST).toBe('smb-server.domain.local');
        expect(krbCall[1].env.SHARE_PATH).toBe('smb/share');
      });

      it('should throw error when both NTLM and Kerberos mounts fail', async () => {
        const fqdnRequest: MountRequest = {
          ...smbRequest,
          hostname: 'smb-server.domain.local',
          fileServerId: 'server-789',
        };

        const dns = require('dns');
        (dns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.0.0.99', family: 4 });

        mockExecAsync
          .mockRejectedValueOnce(new Error('mount failed: Permission denied'))
          .mockRejectedValueOnce(new Error('mount failed: No such file or directory'));

        await expect(service.ensureMounted(fqdnRequest)).rejects.toThrow(
          /Both NTLM and Kerberos authentication were unsuccessful/,
        );
      });

      it('should always attempt Kerberos fallback regardless of NTLM error type', async () => {
        const fqdnRequest: MountRequest = {
          ...smbRequest,
          hostname: 'smb-server.domain.local',
          fileServerId: 'server-789',
        };

        const dns = require('dns');
        (dns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.0.0.99', family: 4 });

        // Any NTLM failure triggers Kerberos fallback (not just Permission denied)
        mockExecAsync
          .mockRejectedValueOnce(new Error('mount: No route to host'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const result = await service.ensureMounted(fqdnRequest);

        expect(result.protocol).toBe(Protocol.SMB);
        // Should have attempted Kerberos mount (sec=krb5)
        const krbCall = mockExecAsync.mock.calls.find((c: any[]) => String(c[0]).includes('sec=krb5'));
        expect(krbCall).toBeDefined();
      });

      it('should use original hostname (not resolved IP) for Kerberos mount', async () => {
        const hostnameRequest: MountRequest = {
          ...smbRequest,
          hostname: 'anf-server.domain.local',
        };

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        await service.ensureMounted(hostnameRequest);

        // Kerberos mount call should use the original FQDN hostname
        const krbCall = mockExecAsync.mock.calls.find((c: any[]) => String(c[0]).includes('sec=krb5'));
        expect(krbCall).toBeDefined();
        expect(krbCall[1].env.HOST).toBe('anf-server.domain.local');
      });
    });

    describe('ensureHostsEntry', () => {
      it('should skip /etc/hosts when DNS lookup succeeds', async () => {
        const dns = require('dns');
        // Use mockResolvedValue (persistent) so both performDnsResolution and ensureHostsEntry get a resolved value
        (dns.promises.lookup as jest.Mock).mockResolvedValue({ address: '10.0.0.1', family: 4 });
        // NTLM fails, Kerberos path runs
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'resolvable.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.debug).toHaveBeenCalledWith(
          expect.stringContaining('resolves via DNS'),
        );
        expect(fs.promises.appendFile).not.toHaveBeenCalled();
      });

      it('should skip when /etc/hosts already contains the hostname', async () => {
        const dns = require('dns');
        // Call #1: performDnsResolution (resolveHostToIp) → system DNS → resolves OK
        // Call #2: ensureHostsEntry dns.promises.lookup → fails → triggers /etc/hosts check
        // Call #3: ensureHostsEntry → performDnsResolution → system DNS → resolves OK (needed to get IP for hosts check)
        (dns.promises.lookup as jest.Mock)
          .mockResolvedValueOnce({ address: '172.30.1.1', family: 4 })
          .mockRejectedValueOnce(new Error('DNS not available'))
          .mockResolvedValueOnce({ address: '172.30.1.1', family: 4 });

        // readFile is called for /etc/hosts — return entry containing the hostname
        (fs.promises.readFile as jest.Mock).mockResolvedValue('172.30.1.1 existing.domain.local\n');
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'existing.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.debug).toHaveBeenCalledWith(
          expect.stringContaining('already contains entry'),
        );
      });

      it('should warn when IP cannot be resolved for hostname', async () => {
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        // performDnsResolution returns the hostname itself (unresolved)
        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'unresolvable.domain.local', fileServerId: undefined };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Cannot resolve IP'),
        );
      });

      it('should warn when /etc/hosts write fails', async () => {
        (fs.promises.readFile as jest.Mock).mockResolvedValue('# empty hosts\n');
        (fs.promises.appendFile as jest.Mock).mockRejectedValueOnce(new Error('Read-only filesystem'));

        // Set up FileServer with DNS so IP resolves
        const mockRepo = (service as any).fileServerRepository;
        mockRepo.findOne = jest.fn().mockResolvedValue({ dnsServer: '192.168.1.10' });

        const dns = require('dns');
        const dnsMock = { resolve4: jest.fn((_h: string, cb: any) => cb(null, ['10.0.0.50'])), setServers: jest.fn() };
        const origResolver = dns.Resolver;
        dns.Resolver = jest.fn(() => dnsMock);

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'newhost.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to update /etc/hosts'),
        );
        dns.Resolver = origResolver;
      });
    });

    describe('ensureKrb5Conf', () => {
      it('should skip when krb5.conf already has active KDC entry', async () => {
        (fs.promises.readFile as jest.Mock).mockResolvedValue('[realms]\n    REALM = {\n        kdc = 1.2.3.4\n    }\n');

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.debug).toHaveBeenCalledWith(
          expect.stringContaining('already has an active KDC entry'),
        );
      });

      it('should warn when realm cannot be derived from short hostname', async () => {
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'shortname' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Cannot derive Kerberos realm'),
        );
      });

      it('should warn when no DNS server configured for FileServer', async () => {
        const mockRepo = (service as any).fileServerRepository;
        mockRepo.findOne = jest.fn().mockResolvedValue({ dnsServer: '' });

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('No DNS server configured'),
        );
      });

      it('should handle FileServer repository error gracefully', async () => {
        const mockRepo = (service as any).fileServerRepository;
        mockRepo.findOne = jest.fn().mockRejectedValue(new Error('DB connection lost'));

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to get DNS server from FileServer'),
        );
      });

      it('should write krb5.conf when FileServer has DNS server configured', async () => {
        const mockRepo = (service as any).fileServerRepository;
        mockRepo.findOne = jest.fn().mockResolvedValue({ dnsServer: '10.0.0.5' });

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(fs.promises.writeFile).toHaveBeenCalledWith(
          '/etc/krb5.conf',
          expect.stringContaining('DOMAIN.LOCAL'),
          'utf8',
        );
        expect(loggerService.log).toHaveBeenCalledWith(
          expect.stringContaining('Wrote /etc/krb5.conf'),
        );
      });

      it('should warn when krb5.conf write fails', async () => {
        const mockRepo = (service as any).fileServerRepository;
        mockRepo.findOne = jest.fn().mockResolvedValue({ dnsServer: '10.0.0.5' });
        // First writeFile call is for credentials file (.cifs-*.cred) — let it succeed.
        // Second writeFile call is for /etc/krb5.conf — make it fail.
        (fs.promises.writeFile as jest.Mock)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Permission denied'));

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await service.ensureMounted(hostnameReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to write /etc/krb5.conf'),
        );
      });
    });

    describe('obtainKerberosTicket', () => {
      it('should warn and skip when no username provided', async () => {
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const noCredsReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local', username: '', password: '' };
        await service.ensureMounted(noCredsReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('No username or password provided'),
        );
      });

      it('should strip DOMAIN\\ prefix from username for kinit principal', async () => {
        const cp = require('child_process');
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const domainReq: MountRequest = {
          ...smbRequest,
          hostname: 'host.domain.local',
          username: 'DOMAIN\\adadmin',
        };
        await service.ensureMounted(domainReq);

        expect(cp.spawn).toHaveBeenCalledWith('kinit', ['adadmin@DOMAIN.LOCAL'], expect.any(Object));
      });

      it('should warn when realm cannot be derived from short hostname', async () => {
        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const shortReq: MountRequest = { ...smbRequest, hostname: 'shorthost', username: 'user', password: 'pass' };
        await service.ensureMounted(shortReq);

        expect(loggerService.warn).toHaveBeenCalledWith(
          expect.stringContaining('Cannot determine Kerberos realm'),
        );
      });

      it('should throw when kinit fails', async () => {
        (global as any).__mockSpawnExitCode = 1;

        mockExecAsync
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce({ stdout: '', stderr: '' });

        const hostnameReq: MountRequest = { ...smbRequest, hostname: 'host.domain.local' };
        await expect(service.ensureMounted(hostnameReq)).rejects.toThrow(
          /Unable to obtain Kerberos ticket/,
        );

        (global as any).__mockSpawnExitCode = 0;
      });
    });
  });

  describe('listDirectories (fs.readdir)', () => {
    const input: ListDirsInput = { mountPath: '/mnt/server-123/nfs/share', path: 'subdir' };

    it('should return directory entries', async () => {
      const mockEntries = [
        { name: 'dir1', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'file1.txt', isDirectory: () => false, isSymbolicLink: () => false },
        { name: 'dir2', isDirectory: () => true, isSymbolicLink: () => false },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectories(input);

      expect(result).toHaveLength(2);
      expect(result.map(d => d.name)).toEqual(expect.arrayContaining(['dir1', 'dir2']));
      expect(loggerService.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 directories'));
    });

    it('should list directories after SMB mount', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mountResult = await service.ensureMounted(smbRequest);
      expect(mountResult.mountPath).toBe('/mnt/server-456/smb/share');
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringMatching(/mount -t cifs/),
        expect.objectContaining({ env: expect.objectContaining({ SHARE_PATH: 'smb/share' }) })
      );

      const mockEntries = [
        { name: 'dir1', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'dir2', isDirectory: () => true, isSymbolicLink: () => false },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const listResult = await service.listDirectories({
        mountPath: mountResult.mountPath,
        path: '.',
      });

      expect(listResult).toHaveLength(2);
      expect(listResult.map(d => d.name)).toEqual(expect.arrayContaining(['dir1', 'dir2']));
      expect(loggerService.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 directories'));
    });

    it('should return empty array when no directories exist', async () => {
      const mockEntries = [
        { name: 'file1.txt', isDirectory: () => false, isSymbolicLink: () => false },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectories(input);

      expect(result).toEqual([]);
    });

    it('should return empty array on ENOENT', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await service.listDirectories(input);

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith(expect.stringContaining('Directory not found'));
    });

    it('should return empty array on "No such file" error', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(new Error('No such file or directory'));

      const result = await service.listDirectories(input);

      expect(result).toEqual([]);
    });

    it('should throw on unexpected errors', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(service.listDirectories(input)).rejects.toThrow('Permission denied');
      expect(loggerService.error).toHaveBeenCalledWith(expect.stringContaining('Error listing directories'));
    });

    it('should normalize double slashes in path', async () => {
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);

      await service.listDirectories({ mountPath: '/mnt/server/', path: '/subdir' });

      expect(fs.promises.readdir).toHaveBeenCalledWith(
        '/mnt/server/subdir',
        expect.any(Object)
      );
    });

    it('should return empty array when path traversal is rejected', async () => {
      const result = await service.listDirectories({
        mountPath: '/mnt/safe',
        path: '../../../etc',
      });

      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith('Path traversal rejected in listDirectories');
    });

    it('should return empty array when normalized path fails second sanitize check', async () => {
      const realNormalize = path.normalize.bind(path);
      const pathNormalizeSpy = jest.spyOn(path, 'normalize').mockImplementation((p: string) => {
        if (p === 'x' || p.includes('x')) return '..';
        return realNormalize(p);
      });
      const result = await service.listDirectories({
        mountPath: '/mnt/base',
        path: 'x',
      });
      pathNormalizeSpy.mockRestore();
      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith('Path traversal rejected in listDirectories');
    });

    it('should return directory names from Dirent.name (no parentPath/path)', async () => {
      const mockEntries = [
        { name: 'dir1', isDirectory: () => true, isSymbolicLink: () => false },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectories(input);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('dir1');
    });

    it('should return empty array when resolved path is outside base (in-function guard)', async () => {
      const realResolve = path.resolve.bind(path);
      const pathResolveSpy = jest.spyOn(path, 'resolve').mockImplementation((...args: string[]) => {
        const resolved = realResolve(...args);
        if (resolved.includes('subdir') && args.length === 1) {
          return '/tmp/outside-path';
        }
        return resolved;
      });
      const result = await service.listDirectories({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });
      pathResolveSpy.mockRestore();
      expect(result).toEqual([]);
      expect(loggerService.warn).toHaveBeenCalledWith('Path traversal rejected in listDirectories');
    });

    it('should exclude symlinks from directory list', async () => {
      const mockEntries = [
        { name: 'd1', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'd2', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'link', isDirectory: () => true, isSymbolicLink: () => true },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);

      const result = await service.listDirectories({
        mountPath: '/mnt/server-123/nfs/share',
        path: 'subdir',
      });

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.name).sort()).toEqual(['d1', 'd2']);
    });

    it('should exclude mount points and junctions from directory list when protocol is SMB', async () => {
      const mountPath = '/mnt/server-123/smb/share';
      const mockEntries = [
        { name: 'd1', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'junction', isDirectory: () => true, isSymbolicLink: () => false },
        { name: 'd2', isDirectory: () => true, isSymbolicLink: () => false },
      ];
      (fs.promises.readdir as jest.Mock).mockResolvedValue(mockEntries);
      const statMock = fs.promises.stat as jest.Mock;
      statMock.mockImplementation((p: string) => {
        const dev = p.endsWith('junction') ? 999 : 1;
        return Promise.resolve({ dev });
      });

      const result = await service.listDirectories({
        mountPath,
        path: 'subdir',
        protocol: Protocol.SMB,
      });

      expect(result).toHaveLength(2);
      expect(result.map((d) => d.name).sort()).toEqual(['d1', 'd2']);
      expect(loggerService.debug).toHaveBeenCalledWith(
        expect.stringContaining('Excluding special file or mountpoint or junction from SMB listing: junction'),
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
        'umount ${DIR_PATH}',
        expect.objectContaining({
          env: expect.objectContaining({ DIR_PATH: mounted.mountPath }),
          timeout: 30000,
        })
      );
      expect(fs.promises.rm).toHaveBeenCalledWith(mounted.mountPath, { recursive: true, force: true });
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
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('umount'),
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
        expect.stringMatching(/umount/),
        expect.objectContaining({ timeout: 30000 })
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
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('umount'),
      );
      expect(umountCalls).toHaveLength(0);

      unmountIfIdleSpy.mockRestore();
    });

    it('should log and not rethrow when performUnmount fails during idle unmount', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);
      mockExecAsync.mockClear();

      mockExecAsync.mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('umount')) {
          return Promise.reject(new Error('umount failed'));
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      const unmountIfIdleSpy = jest.spyOn(service as any, 'unmountIfIdle');
      jest.advanceTimersByTime(10 * 60 * 1000 + 1);

      await unmountIfIdleSpy.mock.results[0]?.value;

      expect(loggerService.error).toHaveBeenCalledWith(expect.stringContaining('Failed to unmount'));
      unmountIfIdleSpy.mockRestore();
    });

    it('should reschedule unmount when unmountIfIdle is called but mount was recently touched', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      const mounted = await service.ensureMounted(nfsRequest);
      await service.touch(mounted.key);
      mockExecAsync.mockClear();

      await (service as any).unmountIfIdle(mounted.key);

      expect(mockExecAsync.mock.calls.some((c: any[]) => c[0] && String(c[0]).includes('umount'))).toBe(false);
    });
  });

  describe('ensureMounted – mount timeout handling', () => {
    it('should throw HttpException on ETIMEDOUT error', async () => {
      const etimedoutErr = new Error('connect ETIMEDOUT') as NodeJS.ErrnoException;
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

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow(/Mount failed for/);
    });

    it('should wrap null/undefined throw from mount as "Mount failed"', async () => {
      mockExecAsync.mockRejectedValue(null);

      await expect(service.ensureMounted(nfsRequest)).rejects.toThrow('Mount failed');
    });

    it('should clean up SMB credentials file even when mount fails', async () => {
      mockExecAsync.mockRejectedValue(new Error('mount failed'));

      await expect(service.ensureMounted(smbRequest)).rejects.toThrow(/Mount failed for/);

      expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringMatching(/\.cred$/));
    });
  });

  describe('onModuleInit – edge cases', () => {
    it('should initialize map when mount list has one entry (no umount or rm on init)', async () => {
      const mountStdout = '192.168.1.1:/export on /mnt/abc/export type nfs (rw)\n';
      mockExecAsync.mockImplementation((cmd: string) => {
        if (cmd === 'mount') return Promise.resolve({ stdout: mountStdout, stderr: '' });
        return Promise.resolve({ stdout: '', stderr: '' });
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockExecAsync.mock.calls.some((c: any[]) => c[0] && String(c[0]).includes('umount'))).toBe(false);
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

      await expect(service.ensureMounted(badRequest)).rejects.toThrow('Invalid path segment');
    });
  });

  describe('listDirectories – edge cases', () => {
    it('should handle undefined path (defaults to ".")', async () => {
      (fs.promises.readdir as jest.Mock).mockResolvedValue([]);

      const result = await service.listDirectories({
        mountPath: '/mnt/server',
        path: undefined as any,
      });

      expect(result).toEqual([]);
    });

    it('should handle non-Error thrown in readdir', async () => {
      (fs.promises.readdir as jest.Mock).mockRejectedValue('string error');

      await expect(
        service.listDirectories({ mountPath: '/mnt/server', path: '.' }),
      ).rejects.toBe('string error');
    });
  });

  describe('buildMountArgs (via ensureMounted)', () => {
    it('should run NFS mount from env template (whole cmd in env)', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await service.ensureMounted(nfsRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}',
        expect.objectContaining({
          env: expect.objectContaining({
            HOST: '192.168.1.100',
            MOUNT_PATH: '/nfs/share',
            DIR_PATH: '/mnt/server-123/nfs/share/subdir',
            PROTOCOL_VERSION: '4',
          }),
          timeout: 120000,
        })
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
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ VERS: '2.1' }),
        })
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
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ VERS: '3.0' }),
        })
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
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ SHARE_PATH: 'smb/share' }),
        })
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
      const module = (service as any).fileServerRepository = mockFileServerRepository;
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
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.100' }) })
      );
      expect(loggerService.log).toHaveBeenCalledWith(expect.stringContaining('is already an IP address'));
    });

    it('should use custom DNS servers from FileServer configuration', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10,192.168.1.11'
      });

      // Mock DNS resolution
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.200']);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockFileServerRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-server' },
        select: ['dnsServer']
      });
      expect(dnsMock.setServers).toHaveBeenCalledWith(['192.168.1.10', '192.168.1.11']);
      
      // Restore original
      require('dns').Resolver = originalResolver;
    });

    it('should fallback to system DNS when custom DNS fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer : '192.168.1.10'
      });

      // Mock DNS resolution - custom fails, system succeeds
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(new Error('Custom DNS failed'), null);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

      // Mock system DNS to succeed
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockResolvedValue({ address: '10.0.0.201' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost2',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.201' }) })
      );
      
      // Restore originals
      require('dns').Resolver = originalResolver;
      require('dns').promises.lookup = originalLookup;
    });

    it('should try FQDN resolution for short hostnames when custom DNS fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      let callCount = 0;
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callCount++;
          if (callCount === 1 && hostname === 'shortname') {
            // First call (shortname) fails
            callback(new Error('Not found'), null);
          } else if (callCount === 2 && hostname === 'shortname.rootdomain.local') {
            // Second call (FQDN) succeeds
            callback(null, ['10.0.0.202']);
          } else {
            callback(new Error('Unexpected call'), null);
          }
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'shortname', // No dots - should trigger FQDN attempt
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(dnsMock.resolve4).toHaveBeenCalledWith('shortname', expect.any(Function));
      expect(dnsMock.resolve4).toHaveBeenCalledWith('shortname.rootdomain.local', expect.any(Function));
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.202' }) })
      );
      
      // Restore original
      require('dns').Resolver = originalResolver;
    });

    it('should fallback to original hostname when all DNS strategies fail', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      // Mock DNS resolution to always fail
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(new Error('DNS failed'), null);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

      // Mock system DNS to also fail
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'failhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: 'failhost' }) })
      );
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('All DNS resolution strategies failed for failhost')
      );
      
      // Restore originals
      require('dns').Resolver = originalResolver;
      require('dns').promises.lookup = originalLookup;
    });

    it('should handle FileServer repository errors gracefully', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer repository to throw error
      mockFileServerRepository.findOne.mockRejectedValue(new Error('Database error'));

      // Mock system DNS to succeed
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockResolvedValue({ address: '10.0.0.203' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost3',
        fileServerId: 'error-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get DNS servers from FileServer error-server')
      );
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.203' }) })
      );
      
      // Restore original
      require('dns').promises.lookup = originalLookup;
    });

    it('should handle empty DNS servers configuration', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with empty dnsServer
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: ''
      });

      // Mock system DNS to succeed
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockResolvedValue({ address: '10.0.0.204' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost4',
        fileServerId: 'empty-dns-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.204' }) })
      );
      
      // Restore original
      require('dns').promises.lookup = originalLookup;
    });

    it('should use cached resolved IP for subsequent mounts with same key', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with DNS servers to trigger resolution logic
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      // Mock DNS resolution to track how many times it's called
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.205']);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

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
      const resolvedIp = await (service as any).resolveHostToIp('cachetest', '/share', result1.key, 'cache-test');
      
      expect(resolvedIp).toBe('10.0.0.205');
      
      // Should not perform DNS resolution again (IP was cached in the mount record)
      expect(dnsMock.resolve4).not.toHaveBeenCalled();
      
      // Restore original
      require('dns').Resolver = originalResolver;
    });

    it('should cache IP in existing mount record during resolution', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      // Mock DNS resolution
      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          callback(null, ['10.0.0.206']);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

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
        expect.stringContaining('Using IP 10.0.0.206 for CIFS mount')
      );
      
      // Restore original
      require('dns').Resolver = originalResolver;
    });

    it('should try individual DNS servers when custom resolver fails', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with multiple DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10,192.168.1.11,192.168.1.12'
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
        setServers: jest.fn()
      });
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => createMockResolver());
      require('dns').Resolver = mockResolver;

      // Mock system DNS to fail
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'testhost5',
        fileServerId: 'multi-dns-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.206' }) })
      );
      
      // Restore originals
      require('dns').Resolver = originalResolver;
      require('dns').promises.lookup = originalLookup;
    });

    it('should handle system DNS usage when no fileServerId provided', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock system DNS to succeed
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockResolvedValue({ address: '10.0.0.207' });

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'nofileserver',
        fileServerId: undefined, // No fileServerId
      };

      await service.ensureMounted(hostnameRequest);

      // Should not attempt to query repository
      expect(mockFileServerRepository.findOne).not.toHaveBeenCalled();
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: '10.0.0.207' }) })
      );
      
      // Restore original
      require('dns').promises.lookup = originalLookup;
    });

    it('should ignore the removed DNS resolution toggle and still attempt SMB hostname resolution', async () => {
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockRejectedValue(new Error('System DNS failed'));

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
          { provide: getRepositoryToken(FileServerEntity), useValue: mockFileServerRepository },
        ],
      }).compile();

      const disabledService = disabledModule.get<MountTrackerService>(MountTrackerService);
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const smbHostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'smb-hostname', // Use hostname instead of IP
        fileServerId: 'test-server',
      };

      await disabledService.ensureMounted(smbHostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          env: expect.objectContaining({ HOST: 'smb-hostname' }),
        })
      );

      expect(mockFileServerRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-server' },
        select: ['dnsServer'],
      });

      require('dns').promises.lookup = originalLookup;
    });

    it('should handle FQDN resolution failure gracefully', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      const dnsMock = {
        resolve4: jest.fn((hostname, callback) => {
          // All DNS resolution attempts fail
          callback(new Error('DNS resolution failed'), null);
        }),
        setServers: jest.fn()
      };
      
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => dnsMock);
      require('dns').Resolver = mockResolver;

      // Mock system DNS to also fail
      const originalLookup = require('dns').promises.lookup;
      require('dns').promises.lookup = jest.fn().mockRejectedValue(new Error('System DNS failed'));

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'short', // Should trigger FQDN attempt
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      // Should try both short name and FQDN
      expect(dnsMock.resolve4).toHaveBeenCalledWith('short', expect.any(Function));
      expect(dnsMock.resolve4).toHaveBeenCalledWith('short.rootdomain.local', expect.any(Function));
      
      // Should fallback to original hostname
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: 'short' }) })
      );
      
      // Restore originals
      require('dns').Resolver = originalResolver;
      require('dns').promises.lookup = originalLookup;
    });

    it('should handle non-Error objects in DNS resolution', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      
      // Mock FileServer with custom DNS servers
      mockFileServerRepository.findOne.mockResolvedValue({
        dnsServer: '192.168.1.10'
      });

      // Mock DNS resolution to throw non-Error object
      const originalResolver = require('dns').Resolver;
      const mockResolver = jest.fn(() => {
        throw 'string error'; // Non-Error object
      });
      require('dns').Resolver = mockResolver;

      const hostnameRequest: MountRequest = {
        ...smbRequest,
        hostname: 'errorhost',
        fileServerId: 'test-server',
      };

      await service.ensureMounted(hostnameRequest);

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ env: expect.objectContaining({ HOST: 'errorhost' }) })
      );
      expect(loggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('DNS resolution error for errorhost')
      );
      
      // Restore original
      require('dns').Resolver = originalResolver;
    });
  });
});
