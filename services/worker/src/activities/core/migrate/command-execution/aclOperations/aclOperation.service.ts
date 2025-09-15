import { Inject, Injectable } from "@nestjs/common";
import { CommandExecInput } from "../command-execution.type";
import { StampMetaOutput } from "../stamp-meta.type";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { WinShellService } from "src/activities/common/win-shell.serive";
import { SrcACLReadError, TgtACLWriteError } from "./aclOperation.error";


@Injectable()
export class AclOperationService {
    private readonly logger: LoggerService;
    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
       private readonly winShellService: WinShellService,
    ) {
        this.logger = loggerFactory.create(AclOperationService.name);
    }

    async getAclOperation(sourcePath: string): Promise<SecurityDescriptor> {
        try {
            const script = `$srcFile = '${sourcePath.replace(/'/g, "''")}'\n${psGetAclScript}`;
            const rawAcl = await this.winShellService.executeCommand(script);
            return JSON.parse(rawAcl) as SecurityDescriptor;
        } catch (error) {
            this.logger.error(`Failed to get ACL for ${sourcePath}: ${error.message}`);
            throw new SrcACLReadError(`Failed to get ACL for ${sourcePath}: ${error.message}`);
        }
    }

    async setAclOperation(targetPath: string, acl: SecurityDescriptor): Promise<void> {
        try {
            const aclJsonString = JSON.stringify(acl).replace(/'/g, "''");
            const script = `$dstFile = '${targetPath.replace(/'/g, "''")}'\n$aclJson = '${aclJsonString}'\n${psSetAclScript}`;
            await this.winShellService.executeCommand(script);
        } catch (error) {
            this.logger.error(`Failed to set ACL for ${targetPath}: ${error.message}`);
            throw new TgtACLWriteError(`Failed to set ACL for ${targetPath}: ${error.message}`);
        }
    }

    async stampAclOperation({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        let acl: SecurityDescriptor = await this.getAclOperation(sourcePath);
        
        // TODO: Modify ACL if needed based on command details

        await this.setAclOperation(targetPath, acl);
        return output;
    }
}