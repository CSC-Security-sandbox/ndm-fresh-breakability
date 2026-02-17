import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { promisify } from "util";
import * as fs from "fs";
import fg from "fast-glob";
import * as os from "os";
import * as path from "path";
import { Protocol } from "src/constants/enums";
import {
  LoggerFactory,
  LoggerService,
} from "@netapp-cloud-datamigrate/logger-lib";
import {
  MountRequest,
  MountDetails,
  ListDirsInput,
  DirectoryEntry,
} from "./jobconfig.types";

const execFileAsync = promisify(execFile);

function sanitizePathSegment(segment: string): string {
  const s = String(segment).replace(/\0/g, "").trim();
  if (s.includes("..") || path.isAbsolute(s)) {
    throw new Error(`Invalid path segment: ${s}`);
  }
  return s;
}

function resolvePathUnderBase(basePath: string, subPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const combined = path.join(resolvedBase, subPath || ".");
  const resolved = path.resolve(combined);
  const baseWithSep = resolvedBase + path.sep;
  if (resolved !== resolvedBase && !resolved.startsWith(baseWithSep)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

function sanitizeRelativePathForFs(subPath: string): string {
  const s = String(subPath ?? ".").replace(/\0/g, "").trim().replace(/^\/+/, "") || ".";
  if (path.isAbsolute(s) || s.includes("..")) {
    throw new Error("Path traversal not allowed");
  }
  const normalized = path.normalize(s).replace(/^\/+/, "");
  if (path.isAbsolute(normalized) || normalized.includes("..")) {
    throw new Error("Path traversal not allowed");
  }
  return normalized || ".";
}

function getNormalizedMountSegments(request: MountRequest): {
  fileServerId: string;
  exportPath: string;
  dir: string;
} {
  const fileServerId = sanitizePathSegment(request.fileServerId);
  const exportPath = sanitizePathSegment(request.exportPath.replace(/\\/g, "/").replace(/^\/+/, ""));
  const dir = request.dir ? sanitizePathSegment(request.dir.replace(/^\/+/, "")) : "";
  return { fileServerId, exportPath, dir };
}

interface MountRecord extends MountDetails {
  timeoutHandle?: NodeJS.Timeout;
}

@Injectable()
export class MountTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: LoggerService;
  private readonly mountBase: string;
  private readonly idleTimeoutMs: number;
  private readonly mountTimeoutMs: number;
  private readonly unmountTimeoutMs: number;
  private readonly mounts = new Map<string, MountRecord>();
  private readonly inflightMounts = new Map<string, Promise<MountRecord>>();

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly configService: ConfigService,
  ) {
    this.logger = loggerFactory.create(MountTrackerService.name);
    this.mountBase =
      this.configService.get<string>("app.mount.basePath") ?? "/mnt";
    this.idleTimeoutMs =
      this.configService.get<number>("app.mount.idleTimeoutMs") ?? 600000;
    this.mountTimeoutMs =
      this.configService.get<number>("app.mount.timeoutMs") ?? 120000;
    this.unmountTimeoutMs =
      this.configService.get<number>("app.mount.unmountTimeoutMs") ?? 30000;
  }

  private buildSafeMountDir(request: MountRequest): string {
    const { fileServerId, exportPath, dir } = getNormalizedMountSegments(request);
    const combined = path.join(
      this.mountBase,
      fileServerId,
      exportPath,
      dir,
    );
    const resolved = path.resolve(combined);
    const mountBaseResolved = path.resolve(this.mountBase);
    const baseWithSep = mountBaseResolved + path.sep;
    if (
      resolved !== mountBaseResolved &&
      !resolved.startsWith(baseWithSep)
    ) {
      throw new Error("Mount path must stay under " + this.mountBase);
    }
    return resolved;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`MountTrackerService onModuleInit: initializing map from existing mounts under ${this.mountBase}`);
    await this.initializeMapFromExistingMounts();
  }

  private async initializeMapFromExistingMounts(): Promise<void> {
    const mountBaseResolved = path.resolve(this.mountBase);
    const baseWithSep = mountBaseResolved + path.sep;

    let mountPoints: string[] = [];
    try {
      const result = await execFileAsync("mount", [], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      mountPoints = this.parseMountOutput(result.stdout || "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not read mount list for init: ${msg}`);
      return;
    }

    const underBase = mountPoints.filter(
      (p) => p === mountBaseResolved || p.startsWith(baseWithSep),
    );
    if (underBase.length === 0) return;

    const now = Date.now();
    let added = 0;
    for (const mountPath of underBase) {
      const parsed = this.pathToKeyAndSegments(mountPath);
      if (!parsed || this.mounts.has(parsed.key)) continue;
      const record: MountRecord = {
        key: parsed.key,
        fileServerId: parsed.fileServerId,
        hostname: "",
        exportPath: parsed.exportPath,
        dir: parsed.dir || undefined,
        protocol: Protocol.NFS,
        mountPath,
        mountedAt: now,
        lastAccessAt: now - this.idleTimeoutMs,
      };
      this.mounts.set(parsed.key, record);
      this.scheduleUnmount(record);
      added++;
    }
    this.logger.log(`MountTrackerService onModuleInit: initialized map with ${added} existing mount(s) under ${this.mountBase}`);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('MountTrackerService onModuleDestroy: unmounting all tracked mounts');
    await this.unmountAll();
  }

  private parseMountOutput(stdout: string): string[] {
    const paths: string[] = [];
    const re = /\s+on\s+(\S+)\s+type\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
      paths.push(m[1]);
    }
    return paths;
  }

  /**
   * Derives key and segments from a mount path under mountBase.
   */
  private pathToKeyAndSegments(mountPath: string): { key: string; fileServerId: string; exportPath: string; dir: string } | null {
    const mountBaseResolved = path.resolve(this.mountBase);
    const baseWithSep = mountBaseResolved + path.sep;
    const resolved = path.resolve(mountPath);
    if (resolved !== mountBaseResolved && !resolved.startsWith(baseWithSep)) {
      return null;
    }
    const relative = path.relative(mountBaseResolved, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    const parts = relative.split(path.sep).filter(Boolean);
    if (parts.length === 0) return null;
    const fileServerId = parts[0];
    let exportPath: string;
    let dir: string;
    if (parts.length === 1) {
      exportPath = "";
      dir = "";
    } else if (parts.length === 2) {
      exportPath = parts[1];
      dir = "";
    } else {
      exportPath = parts.slice(1, -1).join(path.sep);
      dir = parts[parts.length - 1];
    }
    const key = `${fileServerId}:${exportPath}:${dir}`;
    return { key, fileServerId, exportPath, dir };
  }

  private buildKey(request: MountRequest): string {
    const { fileServerId, exportPath, dir } = getNormalizedMountSegments(request);
    return `${fileServerId}:${exportPath}:${dir}`;
  }

  private buildMountArgs(
    request: MountRequest,
    mountDest: string,
    smbCredentialsPath?: string,
  ): string[] {
    this.logger.log(
      `Building mount args for ${request.protocol} to ${mountDest}`,
    );
    const hostname = request.hostname.replace(/\0/g, "").trim();
    const exportPath = request.exportPath.replace(/\\/g, "/").replace(/\0/g, "").trim();

    if (request.protocol === Protocol.NFS) {
      return [
        "-t",
        "nfs",
        "-o",
        "nolock",
        `${hostname}:${exportPath}`,
        mountDest,
      ];
    }

    if (request.protocol === Protocol.SMB) {
      const normalizedExport = exportPath.replace(/^\/+/, "");
      const version = (request.protocolVersion?.replace(/^v/i, "") || "3.0").replace(/\0/g, "");
      const credsOpt =
        smbCredentialsPath != null
          ? `credentials=${smbCredentialsPath}`
          : "guest";
      const opts = `${credsOpt},vers=${version}`;
      return [
        "-t",
        "cifs",
        `//${hostname}/${normalizedExport}`,
        mountDest,
        "-o",
        opts,
      ];
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
  //Implementation using fs.promises.readdir
  async listDirectoriesls(input: ListDirsInput): Promise<DirectoryEntry[]> {
    const baseResolved = path.resolve(input.mountPath);
    let pathToRead: string;
    try {
      const safeRelative = sanitizeRelativePathForFs(input.path ?? ".");
      pathToRead = path.resolve(path.join(baseResolved, safeRelative));
    } catch {
      this.logger.warn("Path traversal rejected in listDirectoriesls");
      return [];
    }
    if (pathToRead !== baseResolved && !pathToRead.startsWith(baseResolved + path.sep)) {
      this.logger.warn("Path traversal rejected in listDirectoriesls");
      return [];
    }
    const startTime = Date.now();
    this.logger.log(`Listing directories in ${pathToRead}`);

    try {
      const entries = await fs.promises.readdir(pathToRead, { withFileTypes: true });

      const directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => ({ name: entry.name }));

      this.logger.log(`Found ${directories.length} directories`);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(`Directory listing completed in ${duration}s`);
      return directories;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes('ENOENT') || message.includes('No such file')) {
        this.logger.warn(`Directory not found: ${pathToRead}`);
        return [];
      }

      this.logger.error(`Error listing directories: ${message}`);
      throw error;
    }
  }
  //implementation using fast-glob
  async listDirectoriesFastGlob(input: ListDirsInput): Promise<DirectoryEntry[]> {
    let fullPath: string;
    try {
      fullPath = resolvePathUnderBase(input.mountPath, input.path || ".");
    } catch {
      this.logger.warn("Path traversal rejected in listDirectoriesFastGlob");
      return [];
    }
    // In-function guard for static analysis (CodeQL): ensure path stays under base
    const baseResolved = path.resolve(input.mountPath);
    if (fullPath !== baseResolved && !fullPath.startsWith(baseResolved + path.sep)) {
      this.logger.warn("Path traversal rejected in listDirectoriesFastGlob");
      return [];
    }
    const startTime = Date.now();
    this.logger.log(`Listing directories in ${fullPath}`);

    try {
      const entries = await fg(`${fullPath}/**`, {
        onlyDirectories: true,
        deep: 2,
        followSymbolicLinks: false,
        suppressErrors: true,
      });

      const normalizedFullPath = fullPath.replace(/\/$/, '');
      const directories = entries.map(entry => {
        const name = entry.replace(normalizedFullPath + '/', '');
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
    const mountDir = this.buildSafeMountDir(request);
    let credsPath: string | undefined;
    if (request.protocol === Protocol.SMB && request.username) {
      credsPath = path.join(os.tmpdir(), `.cifs-${randomBytes(8).toString("hex")}.cred`);
      const username = request.username.replace(/\0/g, "").trim();
      const password = String(request.password ?? "").replace(/\0/g, "");
      await fs.promises.writeFile(
        credsPath,
        `username=${username}\npassword=${password}\n`,
        { mode: 0o600 },
      );
    }
    try {
      const mountArgs = this.buildMountArgs(request, mountDir, credsPath);
      await fs.promises.mkdir(mountDir, { recursive: true });

      this.logger.log(`Mounting ${request.hostname}:${request.exportPath} to ${mountDir}`);
      try {
        await execFileAsync("mount", mountArgs, {
          timeout: this.mountTimeoutMs,
          maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        // Clean up the directory created by mkdir since the mount failed
        await fs.promises.rm(mountDir, { recursive: true, force: true }).catch(() => {});
        const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        const message = error instanceof Error ? error.message : String(error ?? "Mount failed");
        const isTimeout =
          err?.code === "ETIMEDOUT" ||
          err?.killed === true ||
          message.toLowerCase().includes("timeout");
        if (isTimeout) {
          this.logger.error(`Mount timed out after ${this.mountTimeoutMs / 1000}s: ${request.hostname}:${request.exportPath}`);
          throw new HttpException(
            'Mount timed out after 2 minutes. Check network and file server availability.',
            HttpStatus.GATEWAY_TIMEOUT,
          );
        }
        this.logger.error(`Mount failed for ${request.hostname}:${request.exportPath}: ${message}`);
        const lines = message.split('\n').map(l => l.trim()).filter(Boolean);
        const lastLine = lines[lines.length - 1] || 'Mount failed';
        const userMessage = lastLine.startsWith('Command failed:')
          ? 'Mount failed'
          : lastLine;
        throw new HttpException(
          `Mount failed for ${request.hostname}:${request.exportPath}: ${userMessage}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } finally {
      if (credsPath) {
        await fs.promises.unlink(credsPath).catch(() => {});
      }
    }

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

    const delayMs = Math.max(0, (record.lastAccessAt + this.idleTimeoutMs) - Date.now());
    record.timeoutHandle = setTimeout(() => {
      void this.unmountIfIdle(record.key);
    }, delayMs);
    (record.timeoutHandle as NodeJS.Timeout).unref?.();
  }

  private async unmountIfIdle(key: string): Promise<void> {
    const record = this.mounts.get(key);
    if (!record) return;

    const idleFor = Date.now() - record.lastAccessAt;
    if (idleFor < this.idleTimeoutMs) {
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
    await execFileAsync("umount", [record.mountPath], {
      timeout: this.unmountTimeoutMs,
    });
    await fs.promises.rm(record.mountPath, { recursive: true, force: true });
  }

  private withoutTimer(record: MountRecord): MountDetails {
    const { timeoutHandle, ...rest } = record;
    return rest;
  }
}
