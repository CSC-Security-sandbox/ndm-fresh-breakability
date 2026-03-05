import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, CmdMeta, CommandStatus, ErrorType, FileInfo, JobManagerContext, OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { uuid4 } from "@temporalio/workflow";
import * as fs from "fs";
import * as path from "path";
import { dmError, getFileInfo, isContentUpdate, isMetaUpdated, removePrefix, shouldExcludeOrSkip } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { isExists } from "../utils/utils";
import { FileTypeDetectionService } from "../utils/file-type-detection.service";
import { FileType } from "src/activities/types/tasks";

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
  targetContent: Set<string>;
  maxCommandsPerBatch?: number;
}

export interface ProcessItemsResult {
  commands: Cmd[];
  fileCount: number;
  dirCount: number;
  totalSize: number;
  subDirs: string[];
}

@Injectable()
export class CommandGenerationService {
  private readonly metaUpdatedToleranceMs: number;
  private readonly maxMigrationCommand: number;
  private readonly logger: LoggerService;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly fileTypeDetectionService: FileTypeDetectionService
  ) {
    this.metaUpdatedToleranceMs = this.configService.get('worker.metaUpdatedToleranceMs') || 60000;
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
      subDirs: []
    };

    const isSMB = process.platform === 'win32';
    let lowerCaseSourceData: Set<string> | undefined;
    let lowerCaseTargetData: Set<string> | undefined;

    if (isSMB) {
      lowerCaseSourceData = new Set<string>();
      lowerCaseTargetData = new Set<string>();
      for (const item of targetContent) {
        lowerCaseTargetData.add(item.toLowerCase());
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

        // Check exclude/skip patterns
        if (shouldExcludeOrSkip({
          fullPath: sourceContentPath,
          stats: sourceStat,
          excludePatterns: settings.excludePatterns,
          skipTime: settings.skipFile,
          olderThan: jobContext.jobConfig.options?.excludeOlderThan 
            ? new Date(jobContext.jobConfig.options.excludeOlderThan) 
            : undefined,
          jobType: jobContext.jobConfig.jobType
        })) {
          // For retry items, resolve the original error since the file is now intentionally excluded
          if (itemData.originalCommandId) {
            const resolvedCommand: Cmd = this.buildResolvedCommand(relativePath, sourceStat.isDirectory(), itemData.originalCommandId);
            result.commands.push(resolvedCommand);
          }
          continue;
        }

        // SMB-specific validations
        if (isSMB) {
           const hasSMBError:boolean =  await this.SMBSpecificChecks(jobContext, command, itemName, lowerCaseSourceData!, relativeSourcePath, sourceContentPath, lowerCaseTargetData, targetContent, sourceStat.isDirectory(), errorType);
          if (hasSMBError) continue;
        }

        // Get file info and detect file type
        const fileInfo: FileInfo = await getFileInfo({
          name: itemName,
          fullFilePath: sourceContentPath,
          relativePath: relativeSourcePath
        });
        const fileType = await this.fileTypeDetectionService.detectFileType(sourceContentPath, sourceStat);

        // Process based on file type
        if (sourceStat.isDirectory() && !sourceStat.isSymbolicLink()) {
          result.dirCount++;

          // Check for volume mount points (Windows only)
          if (isSMB && fileType === FileType.VOLUME_MOUNT_POINT) {
            const transientError = new Error(`Volume mount point detected at ${relativeSourcePath}`);
            await jobContext.publishToErrorStream(
              dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath })
            );
            continue;
          }
          result.subDirs.push(relativeSourcePath);
      

          // Generate command if target doesn't have this directory
          if (!targetContent.has(itemName)) {
            const newCommand = this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId);
            if (newCommand) result.commands.push(newCommand);
          }
        } else if (sourceStat.isSymbolicLink()) {
          // Handle symbolic links
          if (!targetContent.has(itemName)) {
            // Check for junctions and symbolic links (Windows only)
            if (isSMB && (fileType === FileType.JUNCTION || fileType === FileType.SYMBOLIC_LINK)) {
              const transientError = new Error(`${fileType} detected at ${relativeSourcePath}`);
              await jobContext.publishToErrorStream(
                dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command?.id, transientError, { name: relativeSourcePath, path: relativeSourcePath })
              );
              continue;
            }
            // Target doesn't exist - create symlink
            const newCommand = this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId);
            if (newCommand) result.commands.push(newCommand);
          } else {
            // Target exists for symlink - compare and potentially update
            const targetFilePath = path.join(targetPath, itemName);
            const targetStatLstat = await fs.promises.lstat(targetFilePath);
            const newCommand = this.buildCommand(sourceStat, fileInfo.path, targetStatLstat, itemData.originalCommandId);
            if (newCommand) result.commands.push(newCommand);
          }
        } else if (!targetContent.has(itemName)) {
          // Regular file, target doesn't exist
          result.fileCount++;
          result.totalSize += sourceStat.size;
          const newCommand = this.buildCommand(sourceStat, fileInfo.path, undefined, itemData.originalCommandId);
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
            const newCommand = this.buildCommand(sourceStat, fileInfo.path, targetStat, itemData.originalCommandId);
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
        await jobContext.publishToErrorStream(dmErr);
        throw error;
      }
    }

    return result;
  }

  private async SMBSpecificChecks(jobContext: JobManagerContext, command: Cmd, itemName: string, lowerCaseSourceData: Set<string>, relativeSourcePath: string, sourceContentPath: string, lowerCaseTargetData ,  targetContent ,  isDirectory: boolean, errorType: ErrorType): Promise<boolean> {
    const errorOpId = command?.id || '';
    const hasConflict = await this.checkAndPublishCaseConflictError(
      jobContext.jobConfig.jobType,
      itemName,
      lowerCaseSourceData!,
      relativeSourcePath,
      sourceContentPath,
      errorOpId,
      jobContext,
      lowerCaseTargetData,
      targetContent,
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
    await jobContext.publishToErrorStream(dmErr);
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
    lowerCaseTargetData?: Set<string>,
    targetContent?: Set<string>,
    isDirectory?: boolean
  ): Promise<boolean> {
    const lowerCaseFileName = itemName.toLowerCase();
    if (lowerCaseSourceData.has(lowerCaseFileName) || (lowerCaseTargetData?.has(lowerCaseFileName) && !targetContent?.has(itemName))) {
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
      await jobContext.publishToErrorStream(dmErr);
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
  buildCommand(sFile: fs.Stats, fPath: string, dFile?: fs.Stats, originalCommandId?: string): Cmd | undefined {
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

    if (isContentUpdate(sFile, dFile)) {
      const isDirectory = sFile.isDirectory();
      return new Cmd(
        uuid4(),
        fPath,
        CommandStatus.READY,
        isDirectory,
        {
          [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.READY, params: {} },
          [OPS_CMD.STAMP_META]: { status: OPS_STATUS.READY, params: {} }
        },
        metadata,
        originalCommandId
      );
    }

    if (isMetaUpdated(sFile, dFile, this.metaUpdatedToleranceMs)) {
      const isDirectory = sFile.isDirectory();
      return new Cmd(
        uuid4(),
        fPath,
        CommandStatus.READY,
        isDirectory,
        {
          [this.getOpsCommand(isDirectory, metadata.isSymLink)]: { status: OPS_STATUS.COMPLETED, params: {} },
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
}
