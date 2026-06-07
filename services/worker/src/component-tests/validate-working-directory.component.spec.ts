import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';

import { ValidateWorkingDirectoryActivity } from '../activities/working-directory/working-directory.service';
import { AuthService } from '../auth/auth.service';
import { Protocols } from '../protocols/protocols';
import { NFSProtocol } from '../protocols/nfs/nfs.protocol';
import { SMBProtocol } from '../protocols/smb/smb.protocol';
import { StorageClientFactory } from '../storage-clients/storage-client.factory';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigError, ConfigStatus } from '../activities/working-directory/working-directory.type';

jest.mock('axios');
import axios from 'axios';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    promises: {
      ...actual.promises,
      writeFile: jest.fn(),
      unlink: jest.fn(),
    },
  };
});

/**
 * Real class chain:
 *   ValidateWorkingDirectoryActivity
 *     → real Protocols.getProtocol → routes to mocked NFSProtocol / SMBProtocol
 *     → real getNfsMountErrorMessage (string pattern matching)
 *     → AuthService (real) → HttpService (mocked Keycloak)
 *     → axios.post (mocked — updateConfigStatus)
 *     → fs.existsSync, fsPromises.writeFile/unlink (mocked)
 *
 * Mocked boundaries:
 *   NFSProtocol.mountPath / unmountPath
 *   SMBProtocol.mountPath / unmountPath
 *   StorageClientFactory.getClient
 *   axios.post
 *   fs.existsSync, fsPromises.writeFile, fsPromises.unlink
 *   HttpService.post (Keycloak)
 */

const TRACE_ID       = 'trace-vwd-01';
const CONFIG_ID      = 'cfg-001';
const BASE_PATH      = '/mnt/worker';
const WORKER_CFG_URL = 'http://worker-config';

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':                      'worker-vwd',
      'worker.baseWorkingPath':               BASE_PATH,
      'worker.connection.workerConfigUrl':    WORKER_CFG_URL,
      'worker.projectId':                     'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockHttpService = {
  post: jest.fn().mockReturnValue(
    of({ data: { access_token: 'vwd-token', expires_in: 300 } }),
  ),
};

const mockNfsMount   = jest.fn().mockResolvedValue(undefined);
const mockNfsUnmount = jest.fn().mockResolvedValue(undefined);
const mockSmbMount   = jest.fn().mockResolvedValue(undefined);
const mockSmbUnmount = jest.fn().mockResolvedValue(undefined);

const mockNfsProtocol = { mountPath: mockNfsMount, unmountPath: mockNfsUnmount } as unknown as NFSProtocol;
const mockSmbProtocol = { mountPath: mockSmbMount, unmountPath: mockSmbUnmount } as unknown as SMBProtocol;

const mockStorageClient        = { configureSmartConnectDns: jest.fn().mockResolvedValue(undefined) };
const mockStorageClientFactory = { getClient: jest.fn().mockReturnValue(mockStorageClient) } as unknown as StorageClientFactory;

function nfsFileServer(host = 'nfs-host') {
  return { host, type: 'NFS', username: 'u', password: 'p', protocolVersion: 'v3', pathId: 'nfs-path' };
}

function basePayload(overrides: Partial<any> = {}) {
  return {
    configId:  CONFIG_ID,
    serverType: 'OtherNAS',
    paths: ['/export/data'],
    listPathPayload: [nfsFileServer()],
    fetchedPath: '/export/data',
    exportsMap: {},
    hasManualUpload: false,
    exportPathWorkingDirectoryProvided: false,
    exportPathPresent: true,
    workingDirectory: 'migration',
    fileServerId: null,
    ...overrides,
  };
}

describe('Component: ValidateWorkingDirectoryActivity', () => {
  let service: ValidateWorkingDirectoryActivity;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);
    (axios.post as jest.Mock).mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidateWorkingDirectoryActivity,   // REAL
        AuthService,                         // REAL
        { provide: ConfigService,          useValue: mockConfigService },
        { provide: LoggerFactory,          useValue: mockLoggerFactory },
        { provide: HttpService,            useValue: mockHttpService },
        { provide: Protocols,              useValue: new Protocols(mockNfsProtocol, mockSmbProtocol) },
        { provide: StorageClientFactory,   useValue: mockStorageClientFactory },
      ],
    }).compile();

    service = module.get<ValidateWorkingDirectoryActivity>(ValidateWorkingDirectoryActivity);
  });

  it('H1 — exportPathWorkingDirectoryProvided=false, NFS mount/unmount succeed → ACTIVE posted, status=success', async () => {
    const result = await service.validateWorkingDirectory(TRACE_ID, basePayload());

    expect(mockNfsMount).toHaveBeenCalledTimes(1);
    expect(mockNfsUnmount).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      `${WORKER_CFG_URL}/api/v1/work-manager/validate/working-directory`,
      expect.objectContaining({ status: ConfigStatus.ACTIVE }),
      expect.any(Object),
    );
    expect(result.status).toBe('success');
  });

  it('H2 — exportPath provided, directory exists and is writable → ACTIVE, status=success', async () => {
    const payload = basePayload({ exportPathWorkingDirectoryProvided: true, exportPathPresent: true });
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);

    const result = await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(mockNfsMount).toHaveBeenCalledTimes(1);
    expect(mockNfsUnmount).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it('H3 — storage-aware type with exportsMap → configureSmartConnectDns called, export path from map', async () => {
    const payload = basePayload({
      serverType: 'Dell',
      exportPathWorkingDirectoryProvided: false,
      exportsMap: { 'nfs-host': '/discovered/export' },
    });

    await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(mockStorageClientFactory.getClient).toHaveBeenCalled();
    expect(mockStorageClient.configureSmartConnectDns).toHaveBeenCalledWith(TRACE_ID, nfsFileServer());
    const [, mountPayload] = (mockNfsMount as jest.Mock).mock.calls[0];
    expect(mountPayload.path).toBe('/discovered/export');
  });

  it('H4 — MANUAL_UPLOAD file server skipped; mount only called for the real file server', async () => {
    const payload = basePayload({
      hasManualUpload: true,
      listPathPayload: [
        { ...nfsFileServer('manual-host'), exportPathSource: 'MANUAL_UPLOAD' },
        nfsFileServer('real-host'),
      ],
      exportPathWorkingDirectoryProvided: false,
    });

    await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(mockNfsMount).toHaveBeenCalledTimes(1);
    const [, mountPayload] = (mockNfsMount as jest.Mock).mock.calls[0];
    expect(mountPayload.hostname).toBe('real-host');
  });

  it('N1 — no paths, no manual upload, no discovered exports → UNABLE_TO_DETECT_EXPORT_PATH, no mount', async () => {
    const payload = basePayload({ paths: [], hasManualUpload: false, exportsMap: {} });

    const result = await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(result.status).toBe('error');
    expect(result.message).toContain(ConfigError.UNABLE_TO_DETECT_EXPORT_PATH);
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: ConfigStatus.ERRORED,
        errorMessage: ConfigError.UNABLE_TO_DETECT_EXPORT_PATH,
      }),
      expect.any(Object),
    );
    expect(mockNfsMount).not.toHaveBeenCalled();
  });

  it('N2 — exportPathPresent=false → INVALID_EXPORT_PATH posted without mount attempt', async () => {
    const payload = basePayload({ exportPathWorkingDirectoryProvided: true, exportPathPresent: false });

    const result = await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(result.status).toBe('error');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorMessage: ConfigError.INVALID_EXPORT_PATH }),
      expect.any(Object),
    );
    expect(mockNfsMount).not.toHaveBeenCalled();
  });

  it('N3 — mount fails with "illegal NFS version value" → PROTOCOL_NOT_SUPPORTED errorMessage', async () => {
    mockNfsMount.mockRejectedValueOnce(new Error('illegal NFS version value: 5'));

    const result = await service.validateWorkingDirectory(TRACE_ID, basePayload());

    expect(result.status).toBe('error');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorMessage: ConfigError.PROTOCOL_NOT_SUPPORTED }),
      expect.any(Object),
    );
  });

  it('N4 — mount fails with "port 2049 blocked" → PROTOCOL_PORT_BLOCKED errorMessage', async () => {
    mockNfsMount.mockRejectedValueOnce(new Error('port 2049 blocked by firewall'));

    const result = await service.validateWorkingDirectory(TRACE_ID, basePayload());

    expect(result.status).toBe('error');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ errorMessage: ConfigError.PROTOCOL_PORT_BLOCKED }),
      expect.any(Object),
    );
  });

  it('N5 — Working directory exists but checkWritable fails (write test file throws): the error is surfaced as "has no writable permission" and INVALID_WORKING_DIRECTORY is posted', async () => {
    const payload = basePayload({ exportPathWorkingDirectoryProvided: true, exportPathPresent: true });
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fsPromises.writeFile as jest.Mock).mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);

    const result = await service.validateWorkingDirectory(TRACE_ID, payload);

    expect(result.status).toBe('error');
    expect(result.message).toContain('writable');
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: ConfigStatus.ERRORED,
        errorMessage: expect.stringContaining('writable'),
      }),
      expect.any(Object),
    );
  });

  it('N6 — axios.post for updateConfigStatus returns 500 → error thrown', async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error('Request failed with status 500'));

    await expect(service.validateWorkingDirectory(TRACE_ID, basePayload())).rejects.toThrow('API Error');
  });
});
