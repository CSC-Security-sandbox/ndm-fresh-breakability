import { Inject, Injectable, LoggerService } from "@nestjs/common";
import { randomUUID } from 'crypto';
import {
  Cmd,
  CommandStatus,
  ErrorType,
  FileServerDetails,
  JobManagerContext,
  TaskInfo,
  TaskStatus,
  TaskType,
} from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import * as path from 'path';
import {
  dmError,
  isDirectoryLevelMigration,
} from 'src/activities/utils/utils';
import { Operation, Origin } from 'src/activities/utils/utils.types';
import { ProtocolTypes } from "src/protocols/protocols";
import { RedisService } from "src/redis/redis.service";
import { WinOperationService } from "../migrate/command-execution/win-opeartions/win-operation.service";

@Injectable()
export class SetupExportsPathPermissionService {
    private readonly logger: LoggerService;
    constructor(
        @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
        private readonly winOperationService: WinOperationService,
        private readonly redisService: RedisService
    ) {
        this.logger = this.loggerFactory.create(SetupExportsPathPermissionService.name);
    }

    async setupExportPathPermission(jobRunId: string) {
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        if (!jobContext.jobConfig?.destinationFileServer?.protocols[0]?.type.includes(ProtocolTypes.SMB)) {
            this.logger.debug(`Identity mapping not available for jobRunId: ${jobRunId}`);
            return;
        }

        if (!jobContext.jobConfig?.options?.preservePermissions) {
            this.logger.debug(`Skipping ACL setup for jobRunId: ${jobRunId} - preservePermissions is disabled`);
            return;
        }

      if (isDirectoryLevelMigration(jobContext.jobConfig)) {
        this.logger.debug(`Skipping share-level ACL setup for jobRunId: ${jobRunId} - DLM job; ACLs stamped per directory by worker`);
        return;
      }

        this.logger.log(`Starting ACL setup for jobRunId: ${jobRunId}`);
        try {
            await this.setup(jobRunId, jobContext);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`ACL setup failed for jobRunId: ${jobRunId}: ${message}`, error instanceof Error ? error.stack : undefined);
            await this.publishAclSetupError(jobRunId, message);
        }
    }

    async publishAclSetupError(jobRunId: string, errorMessage: string) {
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        const destPath = this.buildUncPath(jobContext.jobConfig.destinationFileServer);

        const operationId = randomUUID();
        const cmd = new Cmd(operationId, '\\', CommandStatus.ERROR, false, {});
        const task = new TaskInfo(
            randomUUID(), jobRunId, TaskType.MIGRATE, TaskStatus.COMPLETED_WITH_ERROR,
            jobContext.jobConfig?.workerIds?.[0] ?? null,
            jobContext.jobConfig?.sourceFileServer?.pathId,
            [cmd],
            jobContext.jobConfig?.destinationFileServer?.pathId,
        );
        await jobContext.publishToTaskStream(task);

        const error = new Error(errorMessage);
        await jobContext.publishToErrorStream(
            dmError('OPERATION', Origin.DESTINATION, Operation.STAMP_META, ErrorType.TRANSIENT_ERROR, operationId, error, { name: '\\', path: destPath }),
            jobRunId
        );
        this.logger.warn(`Published ACL setup error to UI (operationId: ${operationId}, jobRunId: ${jobRunId})`);
    }

    private buildUncPath(fileServer: FileServerDetails): string {
        const normalizedPath = fileServer.path.replace(/^[\\/]+/, '');
        return "\\\\" + path.join(fileServer.hostname, normalizedPath);
    }

    async setup(jobRunId: string, context: JobManagerContext): Promise<void> {
        this.logger.log(`Starting ACL setup for job ${jobRunId}`);
        if (!context?.jobConfig?.destinationFileServer || !context?.jobConfig?.sourceFileServer) {
            this.logger.error('Invalid context: missing file server configuration');
            throw new Error('Invalid context: missing file server configuration');
        }

        const sourcePath = this.buildUncPath(context.jobConfig.sourceFileServer);
        const destPath = this.buildUncPath(context.jobConfig.destinationFileServer);

        // Step 1: Read the full binary security descriptor from the source share root.
        let sourceAcl: SecurityDescriptor;
        try {
            sourceAcl = await this.winOperationService.getAclOperation(sourcePath, true, jobRunId);
            this.logger.debug(`Source ACL: ${JSON.stringify(sourceAcl)}`);
        } catch (error) {
            this.logger.error(`Failed to read source ACL from ${sourcePath}: ${error.message}`, error.stack);
            throw error;
        }

        // Step 2: SID mapping — remap Owner, Group, and every DACL ACE SID
        // from source domain to destination domain if identity mapping is configured.
        if (context.jobConfig?.options?.isIdentityMappingAvailable) {
            this.logger.debug(`Applying SID mapping for job ${jobRunId}`);
            sourceAcl = await this.winOperationService.mapSIDToTarget(sourceAcl, jobRunId);
            this.logger.log(`Mapped Source ACL: ${JSON.stringify(sourceAcl)}`);
        }

        // Step 3: Stamp the exact binary security descriptor onto the destination share root.
        try {
            const result = await this.winOperationService.setAclOperation(destPath, sourceAcl, jobRunId);
            this.logger.debug(`Set ACL result for ${destPath}: ${JSON.stringify(result?.stdout)}`);

            let payload: { success?: boolean; error?: string; unresolved_sids?: string[] } | null = null;
            if (result?.stdout) {
                try { payload = JSON.parse(result.stdout); } catch {
                    this.logger.error(`Failed to parse Set ACL result for ${destPath}: ${result.stdout}`);
                }
            }
            
            const errors: string[] = [];
            if (payload?.unresolved_sids?.length) {
                errors.push(`Unresolved SIDs: ${payload.unresolved_sids.join(', ')}`);
            }
            if (payload?.success === false) {
                errors.push(`Stamp failed: ${payload.error ?? 'unknown error'}`);
            }
            if (errors.length) {
                throw new Error(`Set ACL on ${destPath}: ${errors.join('; ')}`);
            }
        } catch (error) {
            this.logger.error(`Failed to set ACL on destination ${destPath}: ${error.message}`, error.stack);
            throw error;
        }

        // Step 4: Read back the destination ACL and validate it matches what we stamped.
        let destAcl: SecurityDescriptor;
        try {
            destAcl = await this.winOperationService.getAclOperation(destPath, false, jobRunId);
            this.logger.log(`Destination ACL after stamp: ${JSON.stringify(destAcl)}`);
        } catch (error) {
            this.logger.error(`Failed to read back destination ACL from ${destPath}: ${error.message}`, error.stack);
            throw error;
        }

        const validation = await this.winOperationService.validateAclOperation(sourceAcl, destAcl, {
            workflowId: jobRunId,
            sourcePath,
            targetPath: destPath,
        });
        if (validation.inValid.length > 0) {
            throw new Error(`Share root ACL validation mismatch: ${validation.inValid}`);
        }

        this.logger.log(`ACL setup completed for job ${jobRunId}`);
    }
}
