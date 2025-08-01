import { Inject, Injectable } from "@nestjs/common";
import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import * as fs from "fs";
import { ShellService } from "src/activities/common/shell.service";
import { dmError } from "src/activities/utils/utils";
import { Operation, Origin } from "src/activities/utils/utils.types";
import { RedisService } from "src/redis/redis.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { getAclScript, getTransferAclSript, validateSidMapping } from "./sid-mapping.util";
import { AclEntry } from "./sid-mapping.util.type";
import { StampMetaOutput } from "./stamp-meta.type";


@Injectable()
export class StampMetaService {
    private readonly logger: LoggerService;
    private readonly attributeRegex = /^([A-Za-z]:[\\/]|[\\/])/;
    constructor(
        private readonly shellService: ShellService,
        private readonly redisService: RedisService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(StampMetaService.name);
    }

    async stampMetaData(input: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };

        if (
            input.command.ops[OPS_CMD.STAMP_META] &&
            input.command.ops[OPS_CMD.STAMP_META].status !== OPS_STATUS.COMPLETED
        ) {

            if(process.platform === 'win32') {
                // Stamp SID to object
                const sidOutput = await this.stampSIDAclToObject(input);
                output.sourceErrors.push(...sidOutput.sourceErrors);
                output.targetErrors.push(...sidOutput.targetErrors);

                // Stamp Hidden Metadata
                const hiddenAttrOutput = await this.stampFileAttrMeta(input);
                output.sourceErrors.push(...hiddenAttrOutput.sourceErrors);
                output.targetErrors.push(...hiddenAttrOutput.targetErrors);      
                
                // Preserve access and modified time
                const preserveTimeOutput = await this.preserveAccessAndModifiedTime(input);
                output.sourceErrors.push(...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...preserveTimeOutput.targetErrors);

                // Stamp access and modified time
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);

                // Stamp permissions
                const permissionsOutput = await this.stampPermission(input);
                output.sourceErrors.push(...permissionsOutput.sourceErrors);
                output.targetErrors.push(...permissionsOutput.targetErrors);
            }
            else {
                // Stamp GID and UID
                const gidUidOutput = await this.stampGIDandUID(input);
                output.sourceErrors.push(...gidUidOutput.sourceErrors);
                output.targetErrors.push(...gidUidOutput.targetErrors);

                // Preserve access and modified time
                const preserveTimeOutput = await this.preserveAccessAndModifiedTime(input);
                output.sourceErrors.push(...preserveTimeOutput.sourceErrors);
                output.targetErrors.push(...preserveTimeOutput.targetErrors);

                  // Stamp access and modified time
                const timeOutput = await this.stampAccessAndModifiedTime(input);
                output.sourceErrors.push(...timeOutput.sourceErrors);
                output.targetErrors.push(...timeOutput.targetErrors);

                 // Stamp permissions
                const permissionsOutput = await this.stampPermission(input);
                output.sourceErrors.push(...permissionsOutput.sourceErrors);
                output.targetErrors.push(...permissionsOutput.targetErrors);
            }               
        }
        
        // Only update status if the operation exists
        if (input.command.ops[OPS_CMD.STAMP_META]) {
            if(output.sourceErrors.length > 0 || output.targetErrors.length > 0) 
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.ERROR;
            else
                input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;
        }

        return output;
    }

    async stampPermission({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata?.mode) {
            try {
                await fs.promises.chmod(targetPath, command.metadata.mode);
            } catch(error) {
                this.logger.error(`Stamping Permission from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }


    async stampGIDandUID({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata?.gid && command.metadata?.uid && process.platform !== 'win32') {
            try {
                let gid = command.metadata.gid?.toString();
                let uid = command.metadata.uid?.toString();
                if(jobContext.jobConfig.options.isIdentityMappingAvailable) {
                    gid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.gid?.toString(), 'GID')
                    uid = await this.redisService.getOwnerIdentity(jobContext.jobRunId, command.metadata.uid?.toString(), 'UID')
                }
                if(gid && uid)
                    await fs.promises.chown(targetPath, parseInt(uid), parseInt(gid));
            } catch(error) {
                this.logger.error(`Stamping GID and UID from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async stampAccessAndModifiedTime({command, jobContext, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {  
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata.mtime && command.metadata.atime) {
            try {
                await fs.promises.utimes(targetPath, new Date(command.metadata.atime), new Date(command.metadata.mtime));
            } catch(error) {
                this.logger.error(`Stamping Access and Modified Time  to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_TIME, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async preserveAccessAndModifiedTime({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {  
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata.mtime && command.metadata.atime && jobContext.jobConfig.options.preserveAccessTime) {
            try {
                await fs.promises.utimes(sourcePath,new Date(command.metadata.atime),new Date(command.metadata.mtime));
            } catch(error) {
                this.logger.error(`Preserve Access and Modified Time  to ${sourcePath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_TIME, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push(error.code);
            }
        }
        return output;
    }

    async stampSIDAclToObject({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(process.platform !== 'win32') return output;
        try {
            const getSourceAcl = getAclScript(sourcePath);
            command.metadata.sid = await this.shellService.runCommand(getSourceAcl);
        } catch(error) {
            this.logger.error(`Getting ACL for ${sourcePath}, Error: ${error.message}`, error   .stack);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META  , errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr);
            output.sourceErrors.push(error.code);
            return output;
        }
        try {
            const acl = JSON.parse(command.metadata.sid);
        
            const aclMapping: Map<string, string> = new Map();
            let mappingNotFound: string[] = []
            // get SID to username mapping
            if(jobContext.jobConfig.options.isIdentityMappingAvailable) 
                acl.Access.value = await Promise.all(acl.Access.value.map(async (entry: AclEntry) => {
                    const mapped = await this.redisService.getOwnerIdentity(jobContext.jobRunId, entry.IdentityReference, 'SID');
                    if (mapped) {
                        entry.IdentityReference = mapped;
                        aclMapping.set(mapped, entry.IdentityReference);
                    }
                    else mappingNotFound.push(entry.IdentityReference);
                    return entry;
                }))
            
            const transferAclSript = getTransferAclSript(targetPath, command.isDir, acl);
            await this.shellService.runCommand(transferAclSript);

            const getTargetAcl = getAclScript(targetPath);
            const targetRawAcl = await this.shellService.runCommand(getTargetAcl);
            const targetAcl = JSON.parse(targetRawAcl);
            
            command.ops[OPS_CMD.STAMP_META].params.sidMap = validateSidMapping({
                sidMapping: aclMapping, expected: acl, 
                actual: targetAcl, failedMaps: mappingNotFound
            });

        } catch(error) {
            this.logger.error(`Transferring ACL to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }
        return output
    }



    async stampFileAttrMeta({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(process.platform !== 'win32') return output;
        try{
            const fileAttr = await this.shellService.runCommand(`attrib ${sourcePath}`);
            command.ops[OPS_CMD.STAMP_META].params.fileAttr = fileAttr.trim()?.split(/\s+/)?.filter(token => !this.attributeRegex.test(token)).join('')
            this.logger.debug(`File attributes for ${sourcePath}: ${command.ops[OPS_CMD.STAMP_META].params.fileAttr}`);

        }catch(error) {
            this.logger.error(`Getting Attribute for ${sourcePath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META  , errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr);
            output.sourceErrors.push(error.code);
            return output;
        } 
        try{
            let attributeFlags = '';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('H')) attributeFlags += '+H ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('S')) attributeFlags += '+S ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('R')) attributeFlags += '+R ';
            if (command.ops[OPS_CMD.STAMP_META].params.fileAttr?.includes('A')) attributeFlags += '+A ';
            
            this.logger.debug(`Setting file attributes for ${targetPath}: ${attributeFlags}`);

            if (attributeFlags) {
                const command = `attrib ${attributeFlags.trim()} "${targetPath}"`;
                this.logger.debug(`Setting file attributes for ${targetPath}: ${command}`);
                await this.shellService.runCommand(command);
            }

        }catch(error) {
            this.logger.error(`Transferring ACL to ${targetPath}, Error: ${error.message}`, error.stack);
            const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
            await jobContext.publishToErrorStream(dmErr);
            output.targetErrors.push(error.code);
        }

        return output;
    }

}