import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { exec, execFile } from "child_process";
import { randomBytes } from "crypto";
import * as dns from "dns";
import * as net from "net";
import { promisify } from "util";
import * as fs from "fs";
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
import { FileServerEntity } from "../entities/fileserver.entity";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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


function buildPathUnderTrustedBase(trustedBase: string, pathToCheck: string,): string | null {
  const baseResolved = path.resolve(trustedBase);
  const resolved = path.resolve(pathToCheck);
  const baseWithSep = baseResolved + path.sep;
  if (resolved !== baseResolved && !resolved.startsWith(baseWithSep)) {
    return null;
  }
  const relative = path.relative(baseResolved, resolved);
  const segments = relative.split(path.sep).filter(Boolean);
  if (segments.some((s) => s === ".." || s.includes("/") || s.includes("\\"))) {
    return null;
  }
  return path.join(baseResolved, ...segments);
}

async function shouldExcludeSmbEntry(
  entryPath: string,
  allowedBaseResolved: string,
  trustedBaseResolved: string,
  parentStat: fs.Stats | null,
): Promise<{ exclude: boolean; reason?: "mount_or_junction" | "special" }> {
  try {
    const resolvedPath = path.resolve(entryPath);
    const allowedWithSep = allowedBaseResolved + path.sep;
    if (resolvedPath !== allowedBaseResolved && !resolvedPath.startsWith(allowedWithSep)) {
      return { exclude: false };
    }
    const trustedWithSep = trustedBaseResolved + path.sep;
    if (resolvedPath !== trustedBaseResolved && !resolvedPath.startsWith(trustedWithSep)) {
      return { exclude: false };
    }

    const pathForStat = buildPathUnderTrustedBase(trustedBaseResolved, entryPath);
    if (!pathForStat) return { exclude: false };

    const lstat = await fs.promises.lstat(pathForStat);
    const lstatIsSymLink =
      typeof lstat.isSymbolicLink === "function" ? lstat.isSymbolicLink() : false;
    if (lstatIsSymLink) return { exclude: true, reason: "special" };
    const lstatIsDir =
      typeof lstat.isDirectory === "function" ? lstat.isDirectory() : true;
    if (!lstatIsDir) return { exclude: true, reason: "special" };
    if (
      (typeof lstat.isBlockDevice === "function" && lstat.isBlockDevice()) ||
      (typeof lstat.isCharacterDevice === "function" && lstat.isCharacterDevice()) ||
      (typeof lstat.isFIFO === "function" && lstat.isFIFO()) ||
      (typeof lstat.isSocket === "function" && lstat.isSocket())
    ) {
      return { exclude: true, reason: "special" };
    }

    const dirStat = await fs.promises.stat(pathForStat);
    const parent = parentStat ?? await fs.promises.stat(path.dirname(pathForStat));

    // SMB mountpoint/junction heuristic: device differs from parent.
    if (dirStat.dev !== parent.dev) {
      return { exclude: true, reason: "mount_or_junction" };
    }

    // Reparse/junction-like behavior can appear as lstat/stat divergence on SMB.
    const statIsDir =
      typeof dirStat.isDirectory === "function" ? dirStat.isDirectory() : true;
    if (!statIsDir) return { exclude: true, reason: "special" };
    if (lstat.dev !== dirStat.dev) return { exclude: true, reason: "special" };
    if (lstat.ino != null && dirStat.ino != null && lstat.ino !== dirStat.ino) {
      return { exclude: true, reason: "special" };
    }

    return { exclude: false };
  } catch {
    // Fail closed: unknown/broken entries are treated as special and skipped.
    return { exclude: true, reason: "special" };
  }
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
  resolvedIp?: string; 
}

@Injectable()
export class MountTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: LoggerService;
  private readonly mountBase: string;
  private readonly idleTimeoutMs: number;
  private readonly mountTimeoutMs: number;
  private readonly unmountTimeoutMs: number;
  private readonly nfsMountCmd: string;
  private readonly smbMountCmd: string;
  private readonly unmountCmd: string;
  private readonly cifsBackupUid: number;
  private readonly mounts = new Map<string, MountRecord>();
  private readonly inflightMounts = new Map<string, Promise<MountRecord>>();

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly configService: ConfigService,
    @InjectRepository(FileServerEntity)
    private readonly fileServerRepository: Repository<FileServerEntity>,
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
    this.nfsMountCmd =
      this.configService.get<string>("app.mount.nfsLinuxMountPathCmd") ??
      "mount -t nfs ${HOST}:${MOUNT_PATH} ${DIR_PATH}";
    this.smbMountCmd =
      this.configService.get<string>("app.mount.smbLinuxMountPathCmd") ??
      "mount -t cifs //${HOST}/${SHARE_PATH} ${DIR_PATH} -o credentials=${CREDENTIALS_FILE},vers=${VERS},backupuid=${BACKUPUID}";
    this.unmountCmd =
      this.configService.get<string>("app.mount.unmountCmd") ?? "umount ${DIR_PATH}";
    const configBackupUid = this.configService.get<number>("app.mount.backupuid") ?? 0;
    this.cifsBackupUid = configBackupUid;
  }

  private async resolveHostToIp(host: string, exportPath: string, mountKey: string, fileServerId?: string): Promise<string> {
    const trimmed = host.replace(/\0/g, "").trim();
    const normalizedExportPath = exportPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\0/g, "").trim();
    
    this.logger.log(`Resolving hostname ${trimmed} with export ${normalizedExportPath} for mount`);
    
    // Check if we have a cached resolved IP for this mount
    const existingMount = this.mounts.get(mountKey);
    if (existingMount?.resolvedIp) {
      this.logger.log(`Using cached resolved IP ${existingMount.resolvedIp} for mount key ${mountKey}`);
      return existingMount.resolvedIp;
    }
    
    let resolvedIp: string;
    
    if (net.isIP(trimmed)) {
      this.logger.log(`Host ${trimmed} is already an IP address`);
      resolvedIp = trimmed;
    } else {
      resolvedIp = await this.performDnsResolution(trimmed, fileServerId);
    }
    
    // Cache the resolved IP in the existing mount record if it exists
    if (existingMount) {
      existingMount.resolvedIp = resolvedIp;
      this.logger.log(`Cached resolved IP ${resolvedIp} for existing mount key ${mountKey}`);
    }
    
    this.logger.log(`Resolved hostname ${trimmed} to IP ${resolvedIp} for mount key ${mountKey}`);
    return resolvedIp;
  }
  
  private async performDnsResolution(hostname: string, fileServerId?: string): Promise<string> {
    let customDnsServers: string[] = []; 
    
    if (fileServerId) {
      try {
        const fileServer = await this.fileServerRepository.findOne({
          where: { id: fileServerId },
          select: ['dnsServer']
        });
        
        // Use FileServer's DNS servers if configured
        if (fileServer?.dnsServer) {
          customDnsServers = fileServer.dnsServer.split(',').map(s => s.trim()).filter(Boolean);
          this.logger.debug(`Using custom DNS servers from FileServer ${fileServerId}: ${customDnsServers.join(', ')}`);
        } else {
          this.logger.debug(`No custom DNS servers configured for FileServer ${fileServerId}, using system DNS`);
        }
      } catch (error) {
        this.logger.warn(`Failed to get DNS servers from FileServer ${fileServerId}: ${error.message}`);
      }
    }
    
    try {
      let resolvedIp: string | null = null;
      
      // Strategy 1: Use custom DNS servers if configured
      if (customDnsServers.length > 0) {
        const resolver = new dns.Resolver();
        resolver.setServers(customDnsServers);

        try {
          const addresses = await new Promise<string[]>((resolve, reject) => {
            resolver.resolve4(hostname, (err, addresses) => {
              if (err) reject(err);
              else resolve(addresses || []);
            });
          });
        
        if (addresses.length > 0) {
          this.logger.log(`Resolved ${hostname} to ${addresses[0]} using custom resolver`);
          resolvedIp = addresses[0];
        }
      } catch (resolverError) {
        this.logger.debug(`Custom resolver failed for ${hostname}: ${resolverError.message}`);
        
        if (!hostname.includes('.')) {
          const fqdn = `${hostname}.rootdomain.local`;
          this.logger.debug(`Trying FQDN: ${fqdn}`);
          
          try {
            const addresses = await new Promise<string[]>((resolve, reject) => {
              resolver.resolve4(fqdn, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses || []);
              });
            });
            
            if (addresses.length > 0) {
              this.logger.log(`Resolved ${fqdn} to ${addresses[0]} using custom resolver`);
              resolvedIp = addresses[0];
            }
          } catch (fqdnError) {
            this.logger.debug(`FQDN resolution failed for ${fqdn}: ${fqdnError.message}`);
          }
        }
      }
      
      } else {
        this.logger.debug(`Using system DNS for ${hostname}`);
        try {
          const { address } = await dns.promises.lookup(hostname, { family: 4 });
          this.logger.log(`Resolved ${hostname} to ${address} using system DNS`);
          resolvedIp = address;
        } catch (systemError) {
          this.logger.debug(`System DNS failed for ${hostname}: ${systemError.message}`);
        }
      }
      if (!resolvedIp && customDnsServers.length > 0) {
        this.logger.debug(`Custom DNS failed, trying system DNS for ${hostname}`);
        try {
          const { address } = await dns.promises.lookup(hostname, { family: 4 });
          this.logger.log(`Resolved ${hostname} to ${address} using system DNS fallback`);
          resolvedIp = address;
        } catch (systemError) {
          this.logger.debug(`System DNS fallback failed for ${hostname}: ${systemError.message}`);
        }
      }
      if (!resolvedIp && customDnsServers.length > 0) {
        for (const dnsServer of customDnsServers) {
          try {
            this.logger.debug(`Trying DNS server ${dnsServer} for ${hostname}`);
            const singleResolver = new dns.Resolver();
            singleResolver.setServers([dnsServer]);
            
            const addresses = await new Promise<string[]>((resolve, reject) => {
              singleResolver.resolve4(hostname, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses || []);
              });
            });
            
            if (addresses.length > 0) {
              this.logger.log(`Resolved ${hostname} to ${addresses[0]} using DNS server ${dnsServer}`);
              resolvedIp = addresses[0];
              break;
            }
          } catch (serverError) {
            this.logger.debug(`DNS server ${dnsServer} failed for ${hostname}: ${serverError.message}`);
          }
        }
      }
      if (!resolvedIp) {
        this.logger.warn(`All DNS resolution strategies failed for ${hostname}, using original hostname for mount`);
        return hostname; 
      }
      return resolvedIp;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`DNS resolution error for ${hostname}: ${message}, using original hostname for mount`);
      return hostname; 
    }
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


  private async runCommand(
    template: string,
    envVars: Record<string, string>,
    timeoutMs?: number,
  ): Promise<void> {
    const env = { ...process.env, ...envVars };
    await execAsync(template, {
      env,
      timeout: timeoutMs ?? this.mountTimeoutMs,
      maxBuffer: 1024 * 1024,
    });
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
    const mountBaseResolved = path.resolve(this.mountBase);
    const mountBaseWithSep = mountBaseResolved + path.sep;
    const requestedMountResolved = path.resolve(input.mountPath);
    if (
      requestedMountResolved !== mountBaseResolved &&
      !requestedMountResolved.startsWith(mountBaseWithSep)
    ) {
      this.logger.warn("Mount path not under configured mount base");
      return [];
    }
    let fullPath: string;
    try {
      fullPath = resolvePathUnderBase(input.mountPath, input.path || ".");
    } catch {
      this.logger.warn("Path traversal rejected in listDirectories");
      return [];
    }
    const resolvedFullPath = path.resolve(fullPath);
    if (
      resolvedFullPath !== requestedMountResolved &&
      !resolvedFullPath.startsWith(requestedMountResolved + path.sep)
    ) {
      this.logger.warn("Path traversal rejected in listDirectories");
      return [];
    }
    const safePath = buildPathUnderTrustedBase(
      mountBaseResolved,
      resolvedFullPath,
    );
    if (!safePath) {
      this.logger.warn("Path traversal rejected in listDirectories");
      return [];
    }
    const startTime = Date.now();
    this.logger.log(`Listing directories in ${safePath}`);

    try {
      const entries = await fs.promises.readdir(safePath, {
        withFileTypes: true,
      });
      let directories: DirectoryEntry[] = [];
      const safePathResolved = path.resolve(safePath);
      const mountBaseResolvedForSmb = path.resolve(mountBaseResolved);
      const safePathParentStat = input.protocol === Protocol.SMB
        ? await fs.promises.stat(safePathResolved).catch(() => null)
        : null;
      const candidateDirents = entries.filter(
        (dirent) => dirent.isDirectory() && !dirent.isSymbolicLink(),
      );

      if (input.protocol === Protocol.SMB) {
        // Bounded concurrency improves SMB listing latency without flooding metadata calls.
        const smbCheckBatchSize = 8;
        for (let i = 0; i < candidateDirents.length; i += smbCheckBatchSize) {
          const batch = candidateDirents.slice(i, i + smbCheckBatchSize);
          const checked = await Promise.all(
            batch.map(async (dirent) => {
              const name = dirent.name.split(path.sep).join("/");
              const entryFullPath = path.join(safePathResolved, dirent.name);
              const smbFilter = await shouldExcludeSmbEntry(
                entryFullPath,
                safePathResolved,
                mountBaseResolvedForSmb,
                safePathParentStat,
              );
              return { name, smbFilter };
            }),
          );

          for (const { name, smbFilter } of checked) {
            if (smbFilter.exclude) {
              this.logger.debug(`Excluding special file or mountpoint or junction from SMB listing: ${name}`);
              continue;
            }
            directories.push({ name });
          }
        }
      } else {
        for (const dirent of candidateDirents) {
          const name = dirent.name.split(path.sep).join("/");
          directories.push({ name });
        }
      }

      this.logger.log(`Found ${directories.length} directories`);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.log(`Directory listing completed in ${duration}s`);
      return directories;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT') || message.includes('No such file')) {
        this.logger.warn(`Directory not found: ${safePath}`);
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
    let resolvedIp: string | undefined;
    
    if (request.protocol === Protocol.SMB) {
      // Always resolve/store IP for CIFS mounts (whether direct IP or DNS resolution)
      resolvedIp = await this.resolveHostToIp(
        request.hostname, 
        request.exportPath, 
        key, // Pass mount key for caching
        request.fileServerId
      );
      this.logger.log(`Using IP ${resolvedIp} for CIFS mount ${request.hostname}:${request.exportPath}`);
    }
    if (request.protocol === Protocol.SMB) {
      credsPath = path.join(os.tmpdir(), `.cifs-${randomBytes(8).toString("hex")}.cred`);
      const username = request.username ? request.username.replace(/\0/g, "").trim() : "guest";
      const password = String(request.password ?? "").replace(/\0/g, "");
      await fs.promises.writeFile(
        credsPath,
        `username=${username}\npassword=${password}\n`,
        { mode: 0o600 },
      );
    }
    try {
      await fs.promises.mkdir(mountDir, { recursive: true });

      this.logger.log(`Mounting ${request.hostname}:${request.exportPath} to ${mountDir}`);
      const hostname = (resolvedIp ?? request.hostname).replace(/\0/g, "").trim();
      const exportPath = request.exportPath.replace(/\\/g, "/").replace(/\0/g, "").trim();
      const normalizedExport = exportPath.replace(/^\/+/, "");

      try {
        if (request.protocol === Protocol.NFS) {
          const nfsVersion = (request as MountRequest & { protocolVersion?: string }).protocolVersion?.replace(/\0/g, "") || "4";
          await this.runCommand(this.nfsMountCmd, {
            HOST: request.hostname.replace(/\0/g, "").trim(),
            MOUNT_PATH: exportPath,
            DIR_PATH: mountDir,
            PROTOCOL_VERSION: nfsVersion,
          });
        } else if (request.protocol === Protocol.SMB) {
          const vers = (request.protocolVersion?.replace(/^v/i, "") || "3.0").replace(/\0/g, "");
          const backupUid = this.cifsBackupUid != null ? String(this.cifsBackupUid) : "0";
          await this.runCommand(this.smbMountCmd, {
            HOST: hostname,
            SHARE_PATH: normalizedExport,
            DIR_PATH: mountDir,
            USERNAME: (request.username ?? "").replace(/\0/g, "").trim(),
            PASSWORD: String(request.password ?? "").replace(/\0/g, ""),
            CREDENTIALS_FILE: credsPath ?? "",
            VERS: vers,
            BACKUPUID: backupUid,
          });
        } else {
          throw new Error(`Unsupported protocol: ${request.protocol}`);
        }
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
      resolvedIp: resolvedIp, 
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
    await this.runCommand(
      this.unmountCmd,
      { DIR_PATH: record.mountPath },
      this.unmountTimeoutMs,
    );
    await fs.promises.rm(record.mountPath, { recursive: true, force: true });
  }

  private withoutTimer(record: MountRecord): MountDetails {
    const { timeoutHandle, ...rest } = record;
    return rest;
  }
}
