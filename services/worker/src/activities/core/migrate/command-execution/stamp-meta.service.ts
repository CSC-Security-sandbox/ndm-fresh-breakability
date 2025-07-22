import { OPS_CMD, OPS_STATUS } from "@netapp-cloud-datamigrate/jobs-lib";
import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import { ShellService } from "src/activities/common/shell.service";
import { dmError, formatDate, getUserACLs } from "src/activities/utils/utils";
import { ACL, Operation, Origin } from "src/activities/utils/utils.types";
import { CommandConfig, CommandPattern } from "src/config/command.config";
import { RedisService } from "src/redis/redis.service";
import { CommandExecInput, CommandOutput } from "./command-execution.type";
import { StampMetaOutput } from "./stamp-meta.type";


@Injectable()
export class StampMetaService {
    constructor(
        private readonly logger: Logger,
        private readonly shellService: ShellService,
        private readonly redisService: RedisService,
    ) {}

    async stampMetaData(input: CommandExecInput): Promise<CommandOutput> {
        const output: CommandOutput = { shouldStampMeta: false, sourceErrors: [], targetErrors: [] };

        if (
            input.command.ops[OPS_CMD.STAMP_META] &&
            input.command.ops[OPS_CMD.STAMP_META].status !== OPS_STATUS.COMPLETED
        ) {
            // Stamp permissions
            const permissionsOutput = await this.stampPermission(input);
            output.sourceErrors.push(...permissionsOutput.sourceErrors);
            output.targetErrors.push(...permissionsOutput.targetErrors);

            // Stamp birth time
            const birthTimeOutput = await this.stampBirthTime(input);
            output.sourceErrors.push(...birthTimeOutput.sourceErrors);
            output.targetErrors.push(...birthTimeOutput.targetErrors);

            // Stamp GID and UID
            const gidUidOutput = await this.stampGIDandUID(input);
            output.sourceErrors.push(...gidUidOutput.sourceErrors);
            output.targetErrors.push(...gidUidOutput.targetErrors);

            // Stamp SID to object
            const sidOutput = await this.stampSIDtoObject(input);
            output.sourceErrors.push(...sidOutput.sourceErrors);
            output.targetErrors.push(...sidOutput.targetErrors);

            // Stamp access and modified time
            const timeOutput = await this.stampAccessAndModifiedTime(input);
            output.sourceErrors.push(...timeOutput.sourceErrors);
            output.targetErrors.push(...timeOutput.targetErrors);

            // Preserve access and modified time
            const preserveTimeOutput = await this.preserveAccessAndModifiedTime(input);
            output.sourceErrors.push(...preserveTimeOutput.sourceErrors);
            output.targetErrors.push(...preserveTimeOutput.targetErrors);

        }
        
        if(output.sourceErrors.length > 0 || output.targetErrors.length > 0) 
            input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.ERROR;
        else
            input.command.ops[OPS_CMD.STAMP_META].status = OPS_STATUS.COMPLETED;

        return output;
    }

    async stampPermission({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata?.mode) {
            try {
                await fs.promises.chmod(targetPath, command.metadata.mode);
                throw new Error(`chmod not implemented for ${process.platform}`);
            } catch(error) {

                this.logger.error(`Stamping Permission from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }

    async stampBirthTime({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(command.metadata?.birthtime) {
            try {
                if(process.platform === 'win32') {
                    const birthtime = new Date(command.metadata.birthtime) 
                    var dateString = new Date(birthtime.getTime() - birthtime.getTimezoneOffset() * 60000);
                    var birth_time = dateString.toISOString().replace("T", " ").substr(0, 19);
                    const birthtimeCommand = `(tem.DateTime]::ParseExact('${birth_time}', 'yyyy-MMGet-Item '${targetPath}').CreationTime = [Sys-dd HH:mm:ss', $null)`;
                    await this.shellService.runCommand(birthtimeCommand);
                }else if(command?.isDir === false) {
                    const birthtimeCommand = `touch -t ${formatDate(new Date(command.metadata.birthtime))} ${targetPath}`;
                    await this.shellService.runCommand(birthtimeCommand);
                }
            } catch(error) {
                this.logger.error(`Stamping BirthTime from ${sourcePath} to ${targetPath}, Error: ${error.message}`, error.stack);
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
                await fs.promises.utimes(targetPath,new Date(command.metadata.atime),new Date(command.metadata.mtime));
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


    async getRawSID(filePath: String) : Promise<string> {
        const getSIDCommand = CommandConfig.getSMBCommand(process.platform, CommandPattern.GET_SID_FOR_OBJECT)?.replaceAll('${PATH}', filePath);
        return await this.shellService.runCommand(getSIDCommand);
    }

    async stampSIDtoObject({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        if(process.platform === 'win32') {
            try{
                command.metadata.sid = await this.getRawSID(sourcePath);
            }catch(error) {
                this.logger.error(`Getting ACL for ${sourcePath}, Error: ${error.message}`, error.stack);
                const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.sourceErrors.push(error.code);
                return output;
            }
            try{
                const usersAcls:ACL[] = getUserACLs(command.metadata.sid, sourcePath)
                await Promise.all(
                    usersAcls.map(async (userAcl) => {
                    const user = !jobContext.jobConfig.options.isIdentityMappingAvailable ? 
                        userAcl.user : 
                            await this.redisService.getOwnerIdentity(jobContext.jobRunId, userAcl.user, 'SID');
                    if (user) {
                        const commandExec = command?.isDir === false
                        ? CommandPattern.SET_SID_FOR_OBJECT
                        : CommandPattern.SET_SID_FOR_OBJECT_DIR;
                        const rawCommand = CommandConfig.getSMBCommand(process.platform, commandExec);
                        let setSIDCommand = rawCommand
                        .replace('${PATH}', targetPath)
                        .replace('${USER}', user)
                        .replace('${ACL}', userAcl.permissions);
                        this.logger.warn(` setSIDCommand : ${setSIDCommand}`)
                        const output = await this.shellService.runCommand(setSIDCommand);
                        this.logger.debug(` output : ${output}`)
                    }
                    })
                );
            } 
            catch(error) {
                this.logger.error(`Error setting ownership: ${error.message}`);
                const dmErr = dmError("OPERATION", Origin.DESTINATION, Operation.STAMP_META, errorType, command.id, error, {name: command.fPath, path: targetPath});
                await jobContext.publishToErrorStream(dmErr);
                output.targetErrors.push(error.code);
            }
        }
        return output;
    }
}