import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, FileInfo, JobManagerContext, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, getFileInfo, isContentUpdate, isMetaUpdated, removePrefix, getExcludeOrSkipReason } from "src/activities/utils/utils";
import { RedisService } from "src/redis/redis.service";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isExists } from "../utils/utils";
import { FileTypeDetectionService } from "../utils/file-type-detection.service";
import { FileType } from "src/activities/types/tasks";
import { DeferredDirStamp, DeferredDirStampService } from "./deferred-dir-stamp.service";

/**
 * Interface for target content membership lookups.
 * Supports both in-memory Set<string> (via LocalSetLookup) and Redis-backed (via RedisSetLookup).
 */
export interface TargetContentLookup {
  hasMany(names: string[]): Promise<boolean[]>;
}

/**
 * Wraps an in-memory Set<string> as a TargetContentLookup.
 * Used for small directories or backward compatibility.
 */
export class LocalSetLookup implements TargetContentLookup {
  constructor(private readonly set: Set<string>) {}
  async hasMany(names: string[]): Promise<boolean[]> {
    return names.map(n => this.set.has(n));
  }
}

/**
 * Wraps a Redis Set as a TargetContentLookup using bulk SMISMEMBER.
 * Used for large directories to avoid loading all entries into memory.
 */
export class RedisSetLookup implements TargetContentLookup {
  constructor(
    private readonly jobContext: JobManagerContext,
    private readonly redisKey: string,
  ) {}
  async hasMany(names: string[]): Promise<boolean[]> {
    if (names.length === 0) return [];
    return this.jobContext.areDirContentMembers(this.redisKey, names);
  }
}

/**
 * Input for processing a single source item
 */
export interface ProcessItemInput {
  item: string;                          // File/directory name
  sourcePath: string;                    // Full source directory path
  targetPath: string;                    // Full target directory path
  sourcePrefix: string;                  // Source path prefix for relative path calculation
  targetPrefix: string;                  // Target path prefix
  jobContext: JobManagerContext;
  command: Cmd;                          // Parent command for error reporting
  settings: ProcessItemSettings;
  errorType: ErrorType;
  isSMB: boolean;
  lowerCaseSourceData?: Set<string>;     // For SMB case conflict detection (within batch)
  lowerCaseTargetData?: Set<string>;     // For SMB case conflict detection
  targetContent?: Set<string>;           // Target directory contents
}

export interface ProcessItemSettings {
  skipFile: string;
  excludePatterns: string[];
}

/**
 * Result from processing a single source item
 */
export interface ProcessItemResult {
  command?: Cmd;                         // Generated command (if any)
  isDirectory: boolean;
  isSubDir: boolean;                     // True if this is a directory that should be scanned
  subDirPath?: string;                   // Relative path for subdirectory scanning
  skipped: boolean;                      // True if item was skipped due to validation
}

/**
 * Input for processing multiple items
 */
export interface ProcessItemsInput {
  items: Array<{
    name: string;                        // File/directory name
    fPath?: string;                      // Relative path (for retry, where we have fPath from failed op)
    isDir?: boolean;                     // Known directory status (for retry)
    metadata?: CmdMeta;                  // Existing metadata (for retry)
    originalCommandId?: string;          // Original command ID (for retry error resolution)
  }>;
  sourcePath: string;
  targetPath: string;
  sourcePrefix: string;
  targetPrefix: string;
  jobContext: JobManagerContext;
  command?: Cmd;                         // Required for scan, optional for retry (uses originalCommandId)
  settings: ProcessItemSettings;
  errorType: ErrorType;
  targetContent: TargetContentLookup;
  maxCommandsPerBatch?: number;
  /** Pre-resolved target membership for SMB lowercase conflict detection */
  targetLcLookup?: TargetContentLookup;
  /**
   * Optional store for deferring directory mtime/atime stamping until after
   * all child writes are done. When provided, every directory encountered
   * (created, retried, or already-existing in incremental mode) is recorded
   * so a post-pass activity can re-apply the source timestamps. When omitted,
   * the existing behavior (no deferred stamping) is preserved — useful in
   * unit tests or callers that explicitly opt out.
   */
  deferredDirStampService?: DeferredDirStampService;
}

export interface ProcessItemsResult {
  commands: Cmd[];
  fileCount: number;
  dirCount: number;
  totalSize: number;
  subDirs: string[];
  excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
  skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}

@Injectable()
export class CommandGenerationService {
  private readonly metaUpdatedToleranceMs: number;
  private readonly maxMigrationCommand: number;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly fileTypeDetectionService: FileTypeDetectionService,
    private readonly redisService: RedisService
  ) {
    this.metaUpdatedToleranceMs = this.configService.get<number>('worker.metaUpdatedToleranceMs');
    this.maxMigrationCommand = this.configService.get('worker.maxMigrationCommand') || 100;
    this.logger = loggerFactory.create(CommandGenerationService.name);
  }

  /**
   * Process multiple items and generate commands.
   * Handles SMB validations, file type detection, and command generation.
   */
  async processItems(input: ProcessItemsInput): Promise<ProcessItemsResult> {
    const {
      items,
      sourcePath,
      targetPath,
      sourcePrefix,
      targetPrefix,
      jobContext,
      command,
      settings,
      errorType,
      targetContent,
      maxCommandsPerBatch = this.maxMigrationCommand
    } = input;

    const result: ProcessItemsResult = {
      commands: [],
      fileCount: 0,
      dirCount: 0,
      totalSize: 0,
      subDirs: [],
      excludedPaths: [],
      skippedPaths: [],
    };

    const isSMB = process.platform === 'win32';
    let lowerCaseSourceData: Set<string> | undefined;

    if (isSMB) {
      lowerCaseSourceData = new Set<string>();
    }

    // Bulk pre-resolve target membership for all items in this batch (single Redis call)
    const allItemNames = items.map(item => item.fPath ? path.basename(item.fPath) : item.name);
    const targetMembershipResults = await targetContent.hasMany(allItemNames);
    const targetHasItem = new Map<string, boolean>();
    for (let i = 0; i < allItemNames.length; i++) {
      targetHasItem.set(allItemNames[i], targetMembershipResults[i]);
    }

    // Pre-resolve SMB lowercase target membership in bulk
    let targetLcHasItem: Map<string, boolean> | undefined;
    if (isSMB && input.targetLcLookup) {
      const lcNames = allItemNames.map(n => n.toLowerCase());
      const lcResults = await input.targetLcLookup.hasMany(lcNames);
      targetLcHasItem = new Map<string, boolean>();
      for (let i = 0; i < lcNames.length; i++) {
        targetLcHasItem.set(lcNames[i], lcResults[i]);
      }
    }

    for (const itemData of items) {
      const itemName = itemData.fPath ? path.basename(itemData.fPath) : itemData.name;
      const relativePath = itemData.fPath || itemData.name;
      const sourceContentPath = itemData.fPath
        ? path.join(sourcePrefix, itemData.fPath)
        : path.join(sourcePath, itemData.name);
      try {
        // Check if source exists
        const sourceContentExists = await isExists(sourceContentPath);
        if (!sourceContentExists) {
          // For retry items (has originalCommandId), create a resolved command
          // this handles cases where source was deleted after failure since it is deleted we mark as resolved
          if (itemData.originalCommandId) {
            const resolvedCommand: Cmd = this.buildResolvedCommand(relativePath, itemData.isDir || false, itemData.originalCommandId);
            result.commands.push(resolvedCommand);
          }
          continue;
        }

        // Get source stats
        const sourceStat = await fs.promises.lstat(sourceContentPath);
        const relativeSourcePath = itemData.fPath || removePrefix(sourceContentPath, sourcePrefix);

        // Check exclude/skip patterns and record path for reporting
        const excludeOrSkipReason = getExcludeOrSkipReason({
          fullPath: sourceContentPath,
          stats: sourceStat,
          excludePatterns: settings.excludePatterns,
          skipTime: settings.skipFile,
          olderThan: jobContext.jobConfig.options?.excludeOlderThan
            ? new Date(jobContext.jobConfig.options.excludeOlderThan)
            : undefined,
          jobType: jobContext.jobConfig.jobType,
        });
        if (excludeOrSkipReason !== null) {
          // if (excludeOrSkipReason === 'excluded') {
          //   result.excludedPaths!.push({ path: relativeSourcePath, isDirectory: sourceStat.isDirectory() });
          // } else if (excludeOrSkipReason === 'skipped') {
          //   result.skippedPaths!.push({ path: relativeSourcePath, isDirectory: sourceStat.isDirectory() });
          // }
          if (itemData.originalCommandId) {
            const resolvedCommand: Cmd = this.buildResolvedCommand(relativePath, sourceStat.isDirectory(), itemData.originalCommandId);
            result.commands.push(resolvedCommand);
          }
          continue;
        }

        // SMB-specific validations
        if (isSMB) {
           const hasSMBError: boolean = await this.SMBSpecificChecks(jobContext, command, itemName, lowerCaseSourceData!, relativeSourcePath, sourceContentPath, targetLcHasItem, targetHasItem, sourceStat.isDirectory(), errorType);
          if (hasSMBError) continue;
        }

        // Get file info and detect file type
        const fileInfo: FileInfo = await getFileInfo({
          name: itemName,
          fullFilePath: sourceContentPath,
          relativePath: relativeSourcePath
        });
        const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);

        const itemInTarget = targetHasItem.get(itemName) || false;

        // Process based on file type
        if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
          result.dirCount++;

          // Check for volume mount points (Windows only)
          if (isSMB && fileType === FileType.VOLUME_MOUNT_POINT) {
            const transientError = new Error(`Volume mount point detected at ${relativeSourcePath}`);
            await jobContext.publishToErrorStream(
              dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath }),
              jobContext.jobConfig?.jobRunId
            );
            continue;
          }
          if (!itemInTarget) {
            // CASE 1: mkdir failed — directory does not exist in target.
            // Scan children recursively AND generate a COPY_DIR command.
            result.subDirs.push(relativeSourcePath);
            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
            if (newCommand) result.commands.push(newCommand);
            // Record deferred mtime/atime stamping — child writes will clobber
            // anything the per-command STAMP_META does for this dir.
            await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
          } else if (itemData.originalCommandId) {
            // CASE 2: stamp failed — directory already exists in target, retry with originalCommandId.
            // Generate a stamp-only command (target stat passed in → buildCommand emits STAMP_META only).
            // Do NOT recurse: that would inflate error counts with phantom child errors.
            const targetDirPath = path.join(targetPath, itemName);
            const targetDirStat = await fs.promises.lstat(targetDirPath);
            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetDirStat, itemData.originalCommandId, jobContext);
            if (newCommand) result.commands.push(newCommand);
            await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
          } else {
            // CASE 3: normal scan — directory exists in target, no originalCommandId.
            // Just recurse into children; no command needed for the directory itself.
            result.subDirs.push(relativeSourcePath);

            // Check if directory metadata (permissions, ownership, timestamps) needs updating
            const targetDirPath = path.join(targetPath, itemName);
            const targetDirExists = await isExists(targetDirPath);
            if (targetDirExists) {
                const targetDirStat = await fs.promises.lstat(targetDirPath);
                const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetDirStat, undefined, jobContext);
                if (newCommand) result.commands.push(newCommand);  // STAMP_META only if needed
            }
            await this.recordDeferredDirStamp(input.deferredDirStampService, jobContext, relativeSourcePath, sourceStat);
          }
        } else if (sourceStat.isSymbolicLink()) {
          // Handle symbolic links
          if (!itemInTarget) {
            // Check for junctions and symbolic links (Windows only)
            if (isSMB && (fileType === FileType.JUNCTION || fileType === FileType.SYMBOLIC_LINK)) {
              const transientError = new Error(`${fileType} detected at ${relativeSourcePath}`);
              await jobContext.publishToErrorStream(
                dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath }),
                jobContext.jobConfig?.jobRunId
              );
              continue;
            }
            // Target doesn't exist - create symlink
            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
            if (newCommand) result.commands.push(newCommand);
          } else {
            // Target exists for symlink - compare and potentially update
            const targetFilePath = path.join(targetPath, itemName);
            const targetStatLstat = await fs.promises.lstat(targetFilePath);
            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetStatLstat, itemData.originalCommandId, jobContext);
            if (newCommand) result.commands.push(newCommand);
          }
        } else if (!itemInTarget) {
          // Regular file, target doesn't exist
          result.fileCount++;
          result.totalSize += sourceStat.size;
          const newCommand = await this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId, jobContext);
          if (newCommand) result.commands.push(newCommand);
        } else {
          // Target exists - compare stats
          const targetFilePath = path.join(targetPath, itemName);
          const targetFileExists = await isExists(targetFilePath);
          if (targetFileExists) {
            const targetStatLstat = await fs.promises.lstat(targetFilePath);
            let targetStat: fs.Stats;
            if (targetStatLstat.isSymbolicLink()) {
              targetStat = targetStatLstat;
            } else {
              targetStat = await fs.promises.stat(targetFilePath);
            }
            const newCommand = await this.buildCommand(sourceStat, fileInfo.path, targetStat, itemData.originalCommandId, jobContext);
            if (newCommand) result.commands.push(newCommand);
          }
        }

        // Publish commands in batches
        if (result.commands.length >= maxCommandsPerBatch) {
          const chunk = result.commands.splice(0, maxCommandsPerBatch);
          await jobContext.publishBulkToCommandStream(chunk);
        }

      } catch (error) {
        this.logger.error(`Error processing item ${itemName} in directory ${sourcePath}: ${error}`);
        const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.READ_DIR, errorType, command?.id, error, { name: command?.fPath || relativePath, path: targetPath });
        await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
        throw error;
      }
    }

    return result;
  }

  private async SMBSpecificChecks(jobContext: JobManagerContext, command: Cmd, itemName: string, lowerCaseSourceData: Set<string>, relativeSourcePath: string, sourceContentPath: string, targetLcHasItem: Map<string, boolean> | undefined, targetHasItem: Map<string, boolean>, isDirectory: boolean, errorType: ErrorType): Promise<boolean> {
    const errorOpId = command?.id || '';
    const hasConflict = await this.checkAndPublishCaseConflictError(
      jobContext.jobConfig.jobType,
      itemName,
      lowerCaseSourceData!,
      relativeSourcePath,
      sourceContentPath,
      errorOpId,
      jobContext,
      targetLcHasItem,
      targetHasItem,
      isDirectory
    );
    if (hasConflict) return true;

    const hasTrailingSpace = await this.checkAndPublishTrailingSpaceError(
      itemName,
      relativeSourcePath,
      sourceContentPath,
      errorOpId,
      jobContext,
      errorType
    );
    if (hasTrailingSpace) return true;

    return false;
  }
  /**
   * Checks if filename has trailing spaces/tabs and publishes error if so.
   */
  private async checkAndPublishTrailingSpaceError(
    item: string,
    relativeSourcePath: string,
    sourceContentPath: string,
    operationId: string,
    jobContext: JobManagerContext,
    errorType: ErrorType
  ): Promise<boolean> {
    if (!item.endsWith(' ') && !item.endsWith('\t')) {
      return false;
    }
    const error = new Error(`File not migrated: filename contains trailing spaces`) as Error & { code: string };
    error.code = 'ETRAILSPACE';
    const dmErr = dmError(
      "OPERATION",
      Origin.SOURCE,
      Operation.READ_FILE,
      ErrorType.TRANSIENT_ERROR,
      operationId,
      error,
      { name: relativeSourcePath, path: sourceContentPath }
    );
    await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
    return true;
  }

  /**
   * Checks for case-sensitive conflicts and publishes error if found.
   */
  private async checkAndPublishCaseConflictError(
    jobType: string,
    itemName: string,
    lowerCaseSourceData: Set<string>,
    relativeSourcePath: string,
    sourceContentPath: string,
    operationId: string,
    jobContext: JobManagerContext,
    targetLcHasItem?: Map<string, boolean>,
    targetHasItem?: Map<string, boolean>,
    isDirectory?: boolean
  ): Promise<boolean> {
    const lowerCaseFileName = itemName.toLowerCase();
    if (lowerCaseSourceData.has(lowerCaseFileName) || (targetLcHasItem?.get(lowerCaseFileName) && !targetHasItem?.get(itemName))) {
      const isDiscovery = jobType === "DISCOVER";
      const itemType = isDirectory ? 'Directory' : 'File';
      const errorMessage = isDiscovery 
        ? "Directory contents not discovered: Another directory with same name but different case exists" 
        : `${itemType} not migrated: Another ${itemType.toLowerCase()} with same name but different case exists`;
      const error = new Error(errorMessage) as Error & { code: string };
      error.code = 'EEXIST';
      const origin = isDiscovery ? Origin.SOURCE : Origin.DESTINATION;
      const operationName: Operation = isDiscovery ? Operation.READ_DIR : Operation.COPY_CONTENT;
      const dmErr = dmError("OPERATION", origin, operationName, ErrorType.TRANSIENT_ERROR, operationId, error, { name: relativeSourcePath, path: sourceContentPath });
      await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);
      return true;
    }
    lowerCaseSourceData.add(lowerCaseFileName);
    return false;
  }

  /**
   * Builds a command based on source and optional target stats.
   * Used for both scan and retry operations - compares source vs target.
   * Returns undefined if no update is needed.
   */
  async buildCommand(sFile: fs.Stats, fPath: string, dFile?: fs.Stats, originalCommandId?: string, jobContext?: JobManagerContext): Promise<Cmd | undefined> {
    const metadata: CmdMeta = {
      size: sFile.size,
      mtime: sFile.mtime,
      mode: sFile.mode,
      uid: sFile.uid,
      gid: sFile.gid,
      atime: sFile.atime,
      ctime: sFile.ctime,
      birthtime: sFile.birthtime,
      sid: undefined,
      inode: sFile.ino,
      isSymLink: sFile.isSymbolicLink()
    };

    const targetExisted = !!dFile;
    if (isContentUpdate(sFile, dFile)) {
      const isDirectory = sFile.isDirectory();
      return new Cmd(
        uuid4(),
        fPath,
        CommandStatus.READY,
        isDirectory,
        {
          [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.READY, params: { targetExisted } },
          [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
        },
        metadata,
        originalCommandId
      );
    }

    if (await isMetaUpdated(sFile, dFile, this.metaUpdatedToleranceMs, this.redisService, jobContext)) {
      const isDirectory = sFile.isDirectory();
      return new Cmd(
        uuid4(),
        fPath,
        CommandStatus.READY,
        isDirectory,
        {
          [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.COMPLETED, params: { targetExisted } },
          [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
        },
        metadata,
        originalCommandId
      );
    }

    return undefined;
  }

  /**
   * Gets the appropriate operation command based on file type.
   */
  getOpsCommand(isDirectory: boolean, isSymLink: boolean): string {
    if (isSymLink) {
      return OPS_CMD.COPY_SYMLINK;
    }
    return isDirectory ? OPS_CMD.COPY_DIR : OPS_CMD.COPY_FILE;
  }

  /**
   * Builds a resolved command for retry items where the source no longer exists.
   * This command triggers error resolution in db-writer without performing any copy operation.
   */
  private buildResolvedCommand(fPath: string, isDirectory: boolean, originalCommandId: string): Cmd {
    return new Cmd(
      uuid4(),
      fPath,
      CommandStatus.COMPLETED,
      isDirectory,
      {},
      undefined,
      originalCommandId
    );
  }

  /**
   * Records a directory for deferred mtime/atime restamping after migration.
   * No-op if the caller didn't supply a deferredDirStampService.
   *
   * Failures here are swallowed (logged inside the service) — recording is
   * best-effort and must never fail the surrounding scan/migration.
   */
  private async recordDeferredDirStamp(
    deferredDirStampService: DeferredDirStampService | undefined,
    jobContext: JobManagerContext,
    relativeSourcePath: string,
    sourceStat: fs.Stats,
  ): Promise<void> {
    if (!deferredDirStampService) return;
    if (!sourceStat?.mtime || !sourceStat?.atime) return;
    const record: DeferredDirStamp = {
      fPath: relativeSourcePath,
      atime: new Date(sourceStat.atime).toISOString(),
      mtime: new Date(sourceStat.mtime).toISOString(),
      depth: DeferredDirStampService.computeDepth(relativeSourcePath),
    };
    await deferredDirStampService.add(jobContext.jobRunId, record);
  }
}
