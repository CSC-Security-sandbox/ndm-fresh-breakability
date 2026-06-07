import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { UpgradeActivityService } from '../activities/upgrade/upgrade.activity.service';
import { LinuxBinaryHandler } from '../activities/upgrade/handlers/linux-binary.handler';
import { AuthService } from '../auth/auth.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('fs/promises');
jest.mock('child_process');
jest.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ heartbeat: jest.fn() }) },
}));

import * as fsPromises from 'fs/promises';
import * as childProcess from 'child_process';
const mockedFs = fsPromises as jest.Mocked<typeof fsPromises>;
const mockedExec = childProcess.exec as unknown as jest.Mock;

/**
 * Real classes wired:
 *   UpgradeActivityService → LinuxBinaryHandler.executeUpgrade
 *
 * Mocked boundaries:
 *   fs/promises.access     — checks upgrade script exists
 *   child_process.exec     — spawns systemd-run command
 *
 * executeUpgrade never throws; it always resolves with { status, message }.
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

describe('Component: executeUpgrade (UpgradeActivityService + LinuxBinaryHandler)', () => {
  let activity: UpgradeActivityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

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
        { provide: HttpService,    useValue: { post: jest.fn(), get: jest.fn() } },
      ],
    }).compile();

    activity = module.get<UpgradeActivityService>(UpgradeActivityService);
  });

  // ─── H1: script exists, exec succeeds — returns triggered ────────────────

  it('H1 — script exists and exec succeeds: status "triggered" returned, exec called with systemd-run command', async () => {
    // fs.access resolves (script found)
    mockedFs.access.mockResolvedValue(undefined as any);
    // exec calls the callback with no error
    mockedExec.mockImplementation((_cmd: string, cb: any) => {
      cb(null, 'Running as unit: ndm-worker-upgrade.service', '');
    });

    const result = await activity.executeUpgrade({ version: VERSION, bundleId: 'bundle-h1' });

    expect(result.status).toBe('triggered');
    expect(result.message).toContain('ndm-worker-upgrade');
    // exec was called with a systemd-run command
    const execCmd: string = mockedExec.mock.calls[0][0];
    expect(execCmd).toContain('systemd-run');
    expect(execCmd).toContain(VERSION);
  });

  // ─── H2: bundleId is forwarded through the activity delegation ───────────

  it('H2 — bundleId is passed through: verify UpgradeActivityService.executeUpgrade passes both version and bundleId to the handler without modification (contract between the two real classes is preserved)', async () => {
    mockedFs.access.mockResolvedValue(undefined as any);
    mockedExec.mockImplementation((_cmd: string, cb: any) => {
      cb(null, 'launched', '');
    });

    const handlerSpy = jest.spyOn((activity as any).handler, 'executeUpgrade');

    const result = await activity.executeUpgrade({ version: VERSION, bundleId: 'bundle-xyz' });

    expect(result.status).toBe('triggered');
    expect(handlerSpy).toHaveBeenCalledWith(VERSION, 'bundle-xyz');
  });

  // ─── N1: upgrade script not found — returns failed, exec never called ─────

  it('N1 — upgrade script not found: returns { status: "failed" }, exec never called', async () => {
    // fs.access throws (script missing)
    mockedFs.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await activity.executeUpgrade({ version: VERSION, bundleId: 'bundle-n1' });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Upgrade script not found');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  // ─── N2: exec returns non-zero exit error — returns failed ────────────────

  it('N2 — exec completes but returns a non-zero exit code (e.g., systemctl permission denied): the returned object has status "failed" and the error.message + stderr text is included in the message', async () => {
    mockedFs.access.mockResolvedValue(undefined as any);
    mockedExec.mockImplementation((_cmd: string, cb: any) => {
      cb(new Error('systemctl: command not found'), '', 'systemctl: command not found');
    });

    const result = await activity.executeUpgrade({ version: VERSION, bundleId: 'bundle-n2' });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('systemctl');
  });

  // ─── N3: path traversal version — rejected before exec ──────────────────

  it('N3 — path traversal version "../../etc": fs.access fails at the traversed path, returns { status: "failed" } without ever calling exec', async () => {
    mockedFs.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await activity.executeUpgrade({ version: '../../etc', bundleId: 'bundle-n3' });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('Upgrade script not found');
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
