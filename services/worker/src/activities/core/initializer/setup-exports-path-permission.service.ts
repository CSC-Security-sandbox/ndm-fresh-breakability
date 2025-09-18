import { Inject, LoggerService } from "@nestjs/common";
import { LoggerFactory } from "@netapp-cloud-datamigrate/logger-lib";
import { WinOperationService } from "../migrate/command-execution/win-opeartions/win-operation.service";
import { ProtocolTypes } from "src/protocols/protocols";
import { RedisService } from "src/redis/redis.service";
import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib/dist/types/job-manager-context/job-manager-context";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { ErrorType } from "@netapp-cloud-datamigrate/jobs-lib";

export class SetupExportsPathPermissionService {
    private readonly logger: LoggerService;
    constructor(
        @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
        private readonly winOperationService: WinOperationService,
        private readonly redisService: RedisService
    ) {
        this.logger = this.loggerFactory.create(SetupExportsPathPermissionService.name);
    }

    async setupExportPathPermission(sourcePath: string, targetPath: string, jobRunId: string) {
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        if (!jobContext.jobConfig?.destinationFileServer?.protocols[0]?.type.includes(ProtocolTypes.SMB) || !jobContext.jobConfig?.options?.isIdentityMappingAvailable) {
            this.logger.debug(`Identity mapping not available for jobRunId: ${jobRunId}`);
            return;
        }

        this.logger.log(`Setting up export path permission from ${sourcePath} to ${targetPath}`);
        try {
            const acl: SecurityDescriptor = await this.winOperationService.getAclOperation(sourcePath, false);
            const mappedAcl = await this.winOperationService.mapSIDToTarget(acl, jobRunId);
            const errors: string[] = [];
            if (mappedAcl && mappedAcl.Owner === 'Invalid') {
                errors.push(`Invalid Owner SID for ${mappedAcl.originalOwner} found in SID mapping`);
                mappedAcl.Owner = mappedAcl.originalOwner;
                delete mappedAcl.originalOwner;
            }

            if (mappedAcl && mappedAcl.Group === 'Invalid') {
                errors.push(`Invalid Group SID for ${mappedAcl.originalGroup} found in SID mapping`);
                mappedAcl.Group = mappedAcl.originalGroup;
                delete mappedAcl.originalGroup;
            }
            if (mappedAcl && mappedAcl.DaclAces) {
                mappedAcl.DaclAces.forEach((ace, index) => {
                    if (ace.Sid === 'Invalid') {
                        errors.push(`Invalid ACL SID for ${ace.originalSid} found in SID mapping`);
                        mappedAcl.DaclAces.splice(index, 1);
                    }
                });
            }
            if (mappedAcl && mappedAcl.DaclAces && mappedAcl.DaclAces.length > 0) {
                await this.winOperationService.setAclOperation(targetPath, mappedAcl);
            }
            if (errors.length > 0) {
                if (errors && errors.length > 0) {
                    const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, ErrorType.FATAL_ERROR, '12345', new Error(errors.join(",\n")), { name: targetPath, path: targetPath });
                    await jobContext.publishToErrorStream(dmErr);
                }
            } else {
                this.logger.log(`Successfully set export path permission from ${sourcePath} to ${targetPath}`);
            }
        } catch (error) {
            this.logger.error(`Error setting up export path permission from ${sourcePath} to ${targetPath}: ${error}`);
        }
    }
}