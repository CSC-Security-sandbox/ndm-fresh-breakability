/**
 * Upgrade Activity Service
 * 
 * Thin delegation layer for Temporal activities.
 * All platform + filesystem logic lives in the injected IBinaryHandler.
 * This service only provides Temporal context (heartbeats) and the ack HTTP call.
 * 
 * Activities:
 *   - downloadBundle: Delegates to handler.download()
 *   - isBinaryStaged: Delegates to handler.isBinaryStaged()
 *   - ackUpgrade: POST /api/v1/upgrade/worker/ack (pure HTTP, no platform logic)
 */

import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context } from '@temporalio/activity';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from '../../auth/auth.service';
import { IBinaryHandler } from './binary-handler.interface';
import {
  DownloadBundleInput,
  DownloadBundleOutput,
  ExecuteUpgradeInput,
  ExecuteUpgradeOutput,
} from '../../workflows/upgrade/upgrade.types';

@Injectable()
export class UpgradeActivityService {
  private readonly logger: LoggerService;

  constructor(
    @Inject('BINARY_HANDLER') private readonly handler: IBinaryHandler,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    this.logger = loggerFactory.create(UpgradeActivityService.name);
  }

  // ===========================================================================
  // Temporal heartbeat helper
  // ===========================================================================

  private heartbeat(stage: string): void {
    try {
      Context.current().heartbeat({ stage });
      this.logger.log(`Heartbeat: ${stage}`);
    } catch(error) { 
      this.logger.log(`Heartbeat failed : ${stage} - ${error}`);
     }
  }

  // ===========================================================================
  // Activities
  // ===========================================================================

  /** Check if a version is already staged. */
  async isBinaryStaged(version: string): Promise<{ staged: boolean; platform: 'linux' | 'windows' }> {
    return this.handler.isBinaryStaged(version);
  }

  /** Download bundle from CP, extract, verify, stage. */
  async downloadBundle(input: DownloadBundleInput): Promise<DownloadBundleOutput> {
    return this.handler.download(input.version, (stage) => this.heartbeat(stage));
  }

  /**
   * Spawn the upgrade script as a detached process and return immediately.
   * The script will stop/restart the worker service — this process will die.
   */
  async executeUpgrade(input: ExecuteUpgradeInput): Promise<ExecuteUpgradeOutput> {
    const { version } = input;
    const isWindows = process.platform === 'win32';

    const stagingBase = isWindows
      ? 'C:\\datamigrator\\staging'
      : '/opt/datamigrator/staging';
    const stagingDir = path.join(stagingBase, version);

    const scriptName = isWindows ? 'upgrade.ps1' : 'upgrade.sh';
    const scriptPath = path.join(stagingDir, scriptName);

    this.logger.log(`[executeUpgrade] platform=${process.platform}, isWindows=${isWindows}, scriptPath=${scriptPath}`);

    if (!fs.existsSync(scriptPath)) {
      this.logger.error(`Upgrade script not found: ${scriptPath}`);
      return { status: 'failed', message: `Upgrade script not found: ${scriptPath}` };
    }

    this.logger.log(`[executeUpgrade] Script exists, spawning: ${scriptPath} ${version}`);

    try {
      const logBase = isWindows ? 'C:\\datamigrator' : '/opt/datamigrator';
      const outLog = fs.openSync(path.join(logBase, 'upgrade-spawn.log'), 'a');
      const errLog = fs.openSync(path.join(logBase, 'upgrade-spawn-err.log'), 'a');

      let child;
      if (isWindows) {
        const cmd = `powershell.exe -ExecutionPolicy Bypass -File "${scriptPath}" "${version}"`;
        this.logger.log(`[executeUpgrade] Windows cmd: ${cmd}`);
        child = spawn('cmd.exe', ['/c', 'start', '/b', 'powershell.exe',
          '-ExecutionPolicy', 'Bypass', '-File', scriptPath, version], {
          detached: true,
          stdio: ['ignore', outLog, errLog],
          windowsHide: true,
        });
      } else {
        child = spawn('bash', [scriptPath, version], {
          detached: true,
          stdio: ['ignore', outLog, errLog],
        });
      }

      child.on('error', (err) => {
        this.logger.error(`[executeUpgrade] Spawn error: ${err.message}`);
      });

      child.unref();

      this.logger.log(`[executeUpgrade] Spawned PID ${child.pid}`);
      return { status: 'triggered', message: `Upgrade script spawned with PID ${child.pid}` };
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[executeUpgrade] Failed to spawn: ${msg}`);
      return { status: 'failed', message: msg };
    }
  }

  /** Acknowledge download status to CP. POST /api/v1/upgrade/worker/ack */
  async ackUpgrade(input: {
    version: string;
    status: 'success' | 'failed';
    message?: string;
  }): Promise<void> {
    const cpBaseUrl = process.env.CP_BASE_URL
      || (process.env.CONTROL_PLANE_IP ? `https://${process.env.CONTROL_PLANE_IP}` : null);
    if (!cpBaseUrl) {
      throw new Error('Neither CP_BASE_URL nor CONTROL_PLANE_IP environment variable is set');
    }
    const ackUrl = `${cpBaseUrl}/api/v1/upgrade/worker/ack`;
    const workerId = this.configService.get<string>('worker.workerId');

    this.logger.log(`Sending ack to ${ackUrl} for worker ${workerId}, status: ${input.status}`);

    const authToken = await this.authService.getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      await axios.post(ackUrl, {
        workerId,
        version: input.version,
        status: input.status,
        message: input.message,
      }, { headers, timeout: 30000 });
      this.logger.log(`Ack sent successfully for worker ${workerId}`);
    } catch (error: any) {
      const status = error?.response?.status || '';
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send ack: ${status ? `HTTP ${status} - ` : ''}${msg}`);
    }
  }
}
