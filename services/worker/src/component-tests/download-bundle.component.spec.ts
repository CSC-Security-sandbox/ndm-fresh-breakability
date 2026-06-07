import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { of, throwError } from 'rxjs';
import { UpgradeActivityService } from '../activities/upgrade/upgrade.activity.service';
import { LinuxBinaryHandler } from '../activities/upgrade/handlers/linux-binary.handler';
import { AuthService } from '../auth/auth.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

// ─── Module-level boundary mocks ──────────────────────────────────────────────
jest.mock('fs/promises');
jest.mock('tar');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createWriteStream: jest.fn(),
}));
jest.mock('axios');

// Prevent Temporal Context.current() from throwing in heartbeat()
jest.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ heartbeat: jest.fn() }) },
}));

import * as fsPromises from 'fs/promises';
import * as tar from 'tar';
import * as fsLegacy from 'fs';
const mockedFs = fsPromises as jest.Mocked<typeof fsPromises>;
const mockedTar = tar as jest.Mocked<typeof tar>;
const mockedCreateWriteStream = fsLegacy.createWriteStream as jest.Mock;

/**
 * Real classes wired:
 *   UpgradeActivityService → LinuxBinaryHandler (via BINARY_HANDLER)
 *                          → AuthService → HttpService (Keycloak)
 *
 * Mocked boundaries:
 *   fs/promises            — mkdir, readdir, chmod, unlink, writeFile, rename, readFile, stat, access, rm
 *   fs.createWriteStream   — file streaming
 *   tar.extract            — archive extraction
 *   HttpService.post       — Keycloak token (via real AuthService)
 *   HttpService.get        — bundle download stream
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = {
  create: jest.fn().mockReturnValue(mockLogger),
} as any;

const STAGING_BASE = '/opt/ndm/staging';
const VERSION      = '2.1.0';

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':                  'worker-1',
      'worker.upgrade.stagingDirLinux':   STAGING_BASE,
      'worker.upgrade.baseDirLinux':      '/opt/ndm',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

/** Build a mock HttpService where post returns a Keycloak token */
function makeHttpService(tokenResponse = 'mock-token') {
  return {
    post: jest.fn().mockReturnValue(
      of({ data: { access_token: tokenResponse, expires_in: 300 } }),
    ),
    get: jest.fn(),
  };
}

/** Create a PassThrough-like mock stream that immediately emits 'finish' on the writer */
function makeStreamResponse() {
  const mockStream = new EventEmitter() as any;
  mockStream.pipe = jest.fn((writer: EventEmitter) => {
    setImmediate(() => writer.emit('finish'));
    return writer;
  });
  return {
    headers: { 'content-length': '2048' },
    data: mockStream,
  };
}

/** Create a mock WriteStream */
function makeWriter() {
  const w = new EventEmitter() as any;
  w.write  = jest.fn();
  w.end    = jest.fn();
  w.close  = jest.fn();
  return w;
}

/** Compute a real SHA-256 hex of content */
function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ─── test suite ───────────────────────────────────────────────────────────────

describe('Component: downloadBundle (UpgradeActivityService + LinuxBinaryHandler)', () => {
  let activity: UpgradeActivityService;
  let mockHttpService: ReturnType<typeof makeHttpService>;
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, CP_BASE_URL: 'https://cp.example.com' };
    new WorkersConfig(mockConfigService as any);

    mockHttpService = makeHttpService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpgradeActivityService,
        AuthService,
        {
          provide: 'BINARY_HANDLER',
          useFactory: (
            httpSvc: HttpService,
            authSvc: AuthService,
            cfgSvc: ConfigService,
            loggerFact: LoggerFactory,
          ) => new LinuxBinaryHandler(httpSvc, authSvc, cfgSvc, loggerFact.create('BinaryHandler')),
          inject: [HttpService, AuthService, ConfigService, LoggerFactory],
        },
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
      ],
    }).compile();

    activity = module.get<UpgradeActivityService>(UpgradeActivityService);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── H1: full happy path ────────────────────────────────────────────────

  it('H1 — happy path: auth token fetched via real AuthService, bundle downloaded, extracted, verified, staged', async () => {
    // Filesystem stubs
    const binaryName   = `datamigrator-worker-linux-${VERSION}`;
    const checksumName = `${binaryName}.sha256`;
    const envFileName  = `${binaryName}.env`;
    const binaryContent = Buffer.from('fake binary content long enough');

    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.stat.mockResolvedValue({ size: 2048 } as any);
    (mockedTar.extract as unknown as jest.Mock).mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([binaryName, checksumName, envFileName, 'upgrade.sh'] as any);
    mockedFs.chmod.mockResolvedValue(undefined as any);
    // First readFile call is for checksumPath; subsequent for each file listed in checksum
    mockedFs.readFile.mockImplementation((p: any, opts?: any) => {
      const filePath = String(p);
      const encoding = typeof opts === 'string' ? opts : opts?.encoding;
      if (filePath.endsWith('.sha256')) {
        const content = `${sha256(binaryContent)}  ${binaryName}\n`;
        // verifyChecksums calls readFile with 'utf-8' for the checksum file
        return Promise.resolve(encoding ? content : Buffer.from(content));
      }
      if (filePath.endsWith(binaryName)) return Promise.resolve(binaryContent);
      return Promise.resolve(encoding ? '' : Buffer.from(''));
    });
    mockedFs.unlink.mockResolvedValue(undefined as any);
    mockedFs.access.mockResolvedValue(undefined as any); // pathExists returns true
    mockedFs.rename.mockResolvedValue(undefined as any);
    mockedFs.writeFile.mockResolvedValue(undefined as any);

    // Stream download stub
    const writer = makeWriter();
    mockedCreateWriteStream.mockReturnValue(writer);
    mockHttpService.get.mockReturnValue(of(makeStreamResponse()));

    const result = await activity.downloadBundle({ version: VERSION, bundleId: 'bundle-h1' });

    // Real AuthService called mocked Keycloak
    expect(mockHttpService.post).toHaveBeenCalledWith(
      expect.stringContaining('/protocol/openid-connect/token'),
      expect.any(String),
      expect.any(Object),
    );
    expect(result.platform).toBe('linux');
    expect(result.stagedPath).toContain(VERSION);
    expect(result.binaryPath).toContain(binaryName);
  });

  // ─── H2: bundleId provided — bundle-id-info file is written ─────────────

  it('H2 — bundleId provided: bundle_id line written to conf file', async () => {
    const binaryName   = `datamigrator-worker-linux-${VERSION}`;
    const checksumName = `${binaryName}.sha256`;
    const envFileName  = `${binaryName}.env`;
    const binaryContent = Buffer.from('fake binary content long enough here');

    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.stat.mockResolvedValue({ size: 2048 } as any);
    (mockedTar.extract as unknown as jest.Mock).mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([binaryName, checksumName, envFileName, 'upgrade.sh'] as any);
    mockedFs.chmod.mockResolvedValue(undefined as any);
    mockedFs.readFile.mockImplementation((p: any, opts?: any) => {
      const filePath = String(p);
      const encoding = typeof opts === 'string' ? opts : opts?.encoding;
      if (filePath.endsWith('.sha256')) {
        const content = `${sha256(binaryContent)}  ${binaryName}\n`;
        return Promise.resolve(encoding ? content : Buffer.from(content));
      }
      if (filePath.endsWith(binaryName)) return Promise.resolve(binaryContent);
      return Promise.resolve(encoding ? '' : Buffer.from(''));
    });
    mockedFs.unlink.mockResolvedValue(undefined as any);
    mockedFs.access.mockResolvedValue(undefined as any);
    mockedFs.rename.mockResolvedValue(undefined as any);
    mockedFs.writeFile.mockResolvedValue(undefined as any);

    const writer = makeWriter();
    mockedCreateWriteStream.mockReturnValue(writer);
    mockHttpService.get.mockReturnValue(of(makeStreamResponse()));

    await activity.downloadBundle({ version: VERSION, bundleId: 'bundle-xyz' });

    // At least one writeFile call should contain the bundle_id content
    const writeFileCalls = (mockedFs.writeFile as jest.Mock).mock.calls;
    const bundleInfoWrite = writeFileCalls.find((args: any[]) =>
      String(args[1]).includes('bundle_id=bundle-xyz'),
    );
    expect(bundleInfoWrite).toBeDefined();
  });

  // ─── N1: AuthService.getAccessToken returns null → throws before download ─

  it('N1 — Keycloak unreachable: real AuthService returns null, "Failed to obtain authentication token" thrown', async () => {
    // getAuthHeaders() is called BEFORE ensureStagingDir(), so no staging dir is created
    mockHttpService.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(activity.downloadBundle({ version: VERSION, bundleId: 'bundle-n1' })).rejects.toThrow(
      'Failed to obtain authentication token',
    );
    // No staging dir created — rm not called
    expect(mockedFs.mkdir).not.toHaveBeenCalled();
  });

  // ─── N2: HTTP stream returns 404 → error thrown, staging cleaned up ───────

  it('N2 — HTTP stream returns 404: error thrown with "HTTP 404", staging directory cleaned up', async () => {
    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockHttpService.get.mockReturnValue(
      throwError(() => Object.assign(new Error('Request failed'), { response: { status: 404, statusText: 'Not Found' } })),
    );

    await expect(activity.downloadBundle({ version: VERSION, bundleId: 'bundle-n2' })).rejects.toThrow('HTTP 404');
    expect(mockedFs.rm).toHaveBeenCalled();
  });

  // ─── N3: binary missing after extraction → error thrown, cleanup ──────────

  it('N3 — binary not found after extraction: staging cleaned up, error re-thrown', async () => {
    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.stat.mockResolvedValue({ size: 2048 } as any);
    (mockedTar.extract as unknown as jest.Mock).mockResolvedValue(undefined);
    // readdir returns files WITHOUT the expected binary
    mockedFs.readdir.mockResolvedValue(['upgrade.sh'] as any);

    const writer = makeWriter();
    mockedCreateWriteStream.mockReturnValue(writer);
    mockHttpService.get.mockReturnValue(of(makeStreamResponse()));

    await expect(activity.downloadBundle({ version: VERSION, bundleId: 'bundle-n3' })).rejects.toThrow(
      'Binary not found',
    );
    expect(mockedFs.rm).toHaveBeenCalled();
  });

  // ─── N4: checksum mismatch → staging cleaned up, error thrown ─────────────

  it('N4 — All files are present but the SHA-256 checksum for the binary does not match — verify the staging directory is cleaned up and a "Checksum mismatch" error is thrown', async () => {
    const binaryName   = `datamigrator-worker-linux-${VERSION}`;
    const checksumName = `${binaryName}.sha256`;
    const envFileName  = `${binaryName}.env`;
    const binaryContent = Buffer.from('fake binary content long enough');

    mockedFs.mkdir.mockResolvedValue(undefined as any);
    mockedFs.stat.mockResolvedValue({ size: 2048 } as any);
    (mockedTar.extract as unknown as jest.Mock).mockResolvedValue(undefined);
    mockedFs.readdir.mockResolvedValue([binaryName, checksumName, envFileName, 'upgrade.sh'] as any);
    mockedFs.chmod.mockResolvedValue(undefined as any);
    mockedFs.readFile.mockImplementation((p: any, opts?: any) => {
      const filePath = String(p);
      const encoding = typeof opts === 'string' ? opts : opts?.encoding;
      if (filePath.endsWith('.sha256')) {
        const content = `deadbeefdeadbeefdeadbeefdeadbeef  ${binaryName}\n`;
        return Promise.resolve(encoding ? content : Buffer.from(content));
      }
      if (filePath.endsWith(binaryName)) return Promise.resolve(binaryContent);
      return Promise.resolve(encoding ? '' : Buffer.from(''));
    });
    mockedFs.unlink.mockResolvedValue(undefined as any);
    mockedFs.access.mockResolvedValue(undefined as any);
    mockedFs.rename.mockResolvedValue(undefined as any);
    mockedFs.writeFile.mockResolvedValue(undefined as any);

    const writer = makeWriter();
    mockedCreateWriteStream.mockReturnValue(writer);
    mockHttpService.get.mockReturnValue(of(makeStreamResponse()));

    await expect(activity.downloadBundle({ version: VERSION, bundleId: 'bundle-n4' })).rejects.toThrow(
      'Checksum mismatch',
    );
    expect(mockedFs.rm).toHaveBeenCalled();
  });

  // ─── N5: path traversal in version → rejected before any IO ──────────────

  it('N5 — path traversal version "../../evil": validateVersion rejects before any IO', async () => {
    await expect(activity.downloadBundle({ version: '../../evil', bundleId: 'bundle-n5' })).rejects.toThrow(
      'Invalid version string',
    );
    // No filesystem calls were made
    expect(mockedFs.mkdir).not.toHaveBeenCalled();
    expect(mockHttpService.get).not.toHaveBeenCalled();
  });
});
