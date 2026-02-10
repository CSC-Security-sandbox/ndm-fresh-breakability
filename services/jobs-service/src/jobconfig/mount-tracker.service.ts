import { Inject, Injectable } from "@nestjs/common";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { Protocol } from "src/constants/enums";
import {
  LoggerFactory,
  LoggerService,
} from "@netapp-cloud-datamigrate/logger-lib";

const execAsync = promisify(exec);
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface MountRequest {
  fileServerId: string;
  hostname: string;
  exportPath: string;
  dir: string;
  protocol: Protocol;
  username?: string;
  password?: string;
  protocolVersion?: string;
}

export interface MountDetails {
  key: string;
  fileServerId: string;
  hostname: string;
  exportPath: string;
  dir: string;
  protocol: Protocol;
  mountPath: string;
  mountedAt: number;
  lastAccessAt: number;
}

export interface ListDirsInput {
  mountPath: string;
  path: string;
}

export interface DirectoryEntry {
  name: string;
}

interface MountRecord extends MountDetails {
  timeoutHandle?: NodeJS.Timeout;
}

@Injectable()
export class MountTrackerService {
  private readonly logger: LoggerService;
  private readonly mounts = new Map<string, MountRecord>();
  private readonly inflightMounts = new Map<string, Promise<MountRecord>>();

  constructor(@Inject(LoggerFactory) loggerFactory: LoggerFactory) {
    this.logger = loggerFactory.create(MountTrackerService.name);
  }

  private buildKey(request: MountRequest): string {
    return `${request.fileServerId}:${request.exportPath}:${request.dir}`;
  }

  private buildMountCommand(request: MountRequest, mountDest: string): string {
    console.log('Building mount command with request:', request, 'and mountDest:', mountDest);
    if (request.protocol === Protocol.NFS) {      
      return `mount -t nfs -o nolock ${request.hostname}:${request.exportPath} "${mountDest}"`;
    }

    if (request.protocol === Protocol.SMB) {
      const normalizedExport = request.exportPath.replace(/\\/g, "/");
      const credentials = request.username
        ? `username=${request.username},password=${request.password}`
        : "guest";
      const version = request.protocolVersion?.replace(/^v/i, "") || "3.0";
      return `mount -t cifs //${request.hostname}${normalizedExport} "${mountDest}" -o ${credentials},vers=${version}`;
    }

    throw new Error(`Unsupported protocol: ${request.protocol}`);
  }

  async ensureMounted(request: MountRequest): Promise<MountDetails> {
    const key = this.buildKey(request);
    const existing = this.mounts.get(key);
    if (existing) {
      this.touch(existing.key);
      return this.withoutTimer(existing);
    }

    const pending = this.inflightMounts.get(key);
    if (pending) {
      const record = await pending;
      this.touch(record.key);
      return this.withoutTimer(record);
    }

    const mountPromise = this.createMount(request, key);
    this.inflightMounts.set(key, mountPromise);

    try {
      const record = await mountPromise;
      return this.withoutTimer(record);
    } finally {
      this.inflightMounts.delete(key);
    }
  }

  async listDirectories(input: ListDirsInput): Promise<DirectoryEntry[]> {
    const fullPath = `${input.mountPath}/${input.path}`.replace(/\/+/g, '/');
    const startTime = Date.now();
    this.logger.log(`Listing directories in ${fullPath}`);

    try {
      const { stdout } = await execAsync(
        `find "${fullPath}" -maxdepth 2 -type d 2>/dev/null`,
        { maxBuffer: 1024 * 1024 * 10 }
      );

      const normalizedFullPath = fullPath.replace(/\/$/, '');
      const directories = stdout
        .trim()
        .split('\n')
        .filter(entry => {
          const normalizedEntry = entry.replace(/\/$/, '');
          return entry.length > 0 && normalizedEntry !== normalizedFullPath;
        })
        .map(entry => {
          let name = entry.replace(fullPath, '').replace(/^\//, '');
          if (name === entry) {
            name = entry.replace(normalizedFullPath, '').replace(/^\//, '');
          }
          return { name };
        });

      this.logger.log(`Found ${directories.length} directories`);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(`Directory listing completed in ${duration}s`);
      return directories;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes('ENOENT') || message.includes('No such file')) {
        this.logger.warn(`Directory not found: ${fullPath}`);
        return [];
      }

      this.logger.error(`Error listing directories: ${message}`);
      throw error;
    }
  }

  async listDirectoriesls(input: ListDirsInput): Promise<DirectoryEntry[]> {
    const fullPath = `${input.mountPath}/${input.path}`.replace(/\/+/g, '/');
    const startTime = Date.now();
    this.logger.log(`Listing directories in ${fullPath}`);

    try {
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => {
          // entry.parentPath is available in Node 20+; falls back to entry.path
          const parent = (entry as any).parentPath || (entry as any).path || '';
          const relativePath = parent
            ? `${parent.replace(fullPath, '').replace(/^\//, '')}/${entry.name}`
            : entry.name;
          return { name: relativePath.replace(/^\//, '') };
        });

      this.logger.log(`Found ${directories.length} directories`);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(`Directory listing completed in ${duration}s`);
      return directories;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes('ENOENT') || message.includes('No such file')) {
        this.logger.warn(`Directory not found: ${fullPath}`);
        return [];
      }

      this.logger.error(`Error listing directories: ${message}`);
      throw error;
    }
  }

  async touch(key: string): Promise<void> {
    const record = this.mounts.get(key);
    if (!record) return;
    record.lastAccessAt = Date.now();
    this.scheduleUnmount(record);
  }

  async unmount(key: string): Promise<void> {
    const record = this.mounts.get(key);
    if (!record) return;

    if (record.timeoutHandle) {
      clearTimeout(record.timeoutHandle);
    }

    await this.performUnmount(record);
    this.mounts.delete(key);
  }

  async unmountAll(): Promise<void> {
    const unmounts = Array.from(this.mounts.keys()).map((key) => this.unmount(key));
    await Promise.allSettled(unmounts);
  }

  private async createMount(request: MountRequest, key: string): Promise<MountRecord> {
    const mountDir = `/mnt/${request.fileServerId}${request.exportPath}${request.dir ? '/' + request.dir : ''}`.replace(/\/+/g, '/');
    const mountCmd = this.buildMountCommand(request, mountDir);
    await fs.promises.mkdir(mountDir, { recursive: true });

    this.logger.log(`Mounting ${request.hostname}:${request.exportPath} to ${mountDir}`);
    await execAsync(mountCmd);

    const record: MountRecord = {
      key,
      fileServerId: request.fileServerId,
      hostname: request.hostname,
      exportPath: request.exportPath,
      dir: request.dir,
      protocol: request.protocol,
      mountPath: mountDir,
      mountedAt: Date.now(),
      lastAccessAt: Date.now(),
    };

    this.mounts.set(key, record);
    this.scheduleUnmount(record);
    this.logger.log(`Successfully mounted to ${mountDir}`);

    return record;
  }

  private scheduleUnmount(record: MountRecord): void {
    if (record.timeoutHandle) {
      clearTimeout(record.timeoutHandle);
    }

    record.timeoutHandle = setTimeout(() => {
      void this.unmountIfIdle(record.key);
    }, IDLE_TIMEOUT_MS);
  }

  private async unmountIfIdle(key: string): Promise<void> {
    const record = this.mounts.get(key);
    if (!record) return;

    const idleFor = Date.now() - record.lastAccessAt;
    if (idleFor < IDLE_TIMEOUT_MS) {
      this.scheduleUnmount(record);
      return;
    }

    try {
      await this.performUnmount(record);
      this.mounts.delete(key);
      this.logger.log(`Unmounted ${record.mountPath} after ${Math.floor(idleFor / 1000)}s idle`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to unmount ${record.mountPath}: ${message}`);
    }
  }

  private async performUnmount(record: MountRecord): Promise<void> {
    this.logger.log(`Unmounting ${record.mountPath}`);
    await execAsync(`umount "${record.mountPath}"`);
    await fs.promises.rm(record.mountPath, { recursive: true, force: true });
  }

  private withoutTimer(record: MountRecord): MountDetails {
    const { timeoutHandle, ...rest } = record;
    return rest;
  }
}
