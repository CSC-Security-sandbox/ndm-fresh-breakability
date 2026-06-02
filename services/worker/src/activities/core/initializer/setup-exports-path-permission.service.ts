import { Inject, Injectable, LoggerService } from "@nestjs/common";
import { randomUUID } from 'crypto';
import { ErrorType, FileServerDetails, CommandStatus, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Cmd, TaskInfo } from "@netapp-cloud-datamigrate/jobs-lib/dist/datatype/stream-datatypes";
import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-manager-context/job-manager-context";
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
            this.logger.error(`ACL setup failed for jobRunId: ${jobRunId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
            throw error;
        }
    }

    private buildUncPath(fileServer: FileServerDetails): string {
        return "\\\\" + path.join(fileServer.hostname, fileServer.path);
    }

    async setup(jobRunId: string, context: any): Promise<void> {
        this.logger.debug(`Starting ACL setup for job ${jobRunId}`);
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
            this.logger.debug(`Mapped ACL: ${JSON.stringify(sourceAcl)}`);
        }

        // Step 3: Stamp the exact binary security descriptor onto the destination share root.
        try {
            const result = await this.winOperationService.setAclOperation(destPath, sourceAcl, jobRunId);
            this.logger.debug(`Set ACL result for ${destPath}: ${JSON.stringify(result?.stdout)}`);
        } catch (error) {
            this.logger.error(`Failed to set ACL on destination ${destPath}: ${error.message}`, error.stack);
            throw error;
        }

        // Step 4: Read back the destination ACL and validate it matches what we stamped.
        let destAcl: SecurityDescriptor;
        try {
            destAcl = await this.winOperationService.getAclOperation(destPath, false, jobRunId);
            this.logger.debug(`Destination ACL after stamp: ${JSON.stringify(destAcl)}`);
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
            this.logger.warn(`ACL post-stamp validation mismatch for share root ${destPath}: ${validation.inValid}`);

            const operationId = randomUUID();
            const cmd = new Cmd(operationId, '\\', CommandStatus.ERROR, false, null);
            const task = new TaskInfo(
                randomUUID(), jobRunId, TaskType.MIGRATE, TaskStatus.COMPLETED_WITH_ERROR,
                context.jobConfig?.workerIds?.[0] ?? null,
                context.jobConfig?.sourceFileServer?.pathId,
                [cmd],
                context.jobConfig?.destinationFileServer?.pathId,
            );
            await context.publishToTaskStream(task);

            const error = new Error(`Share root ACL validation mismatch: ${validation.inValid}`);
            await context.publishToErrorStream(
                dmError('OPERATION', Origin.DESTINATION, Operation.STAMP_META, ErrorType.TRANSIENT_ERROR, operationId, error, { name: '\\', path: destPath }),
                context.jobConfig?.jobRunId
            );
            this.logger.warn(`Published share root ACL validation error to error stream (operationId: ${operationId}, jobRunId: ${jobRunId})`);
        }

        this.logger.debug(`ACL setup completed for job ${jobRunId}`);
    }
}
