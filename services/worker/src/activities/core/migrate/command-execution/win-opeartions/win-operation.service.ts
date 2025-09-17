import { Inject, Injectable } from "@nestjs/common";
import { CommandExecInput } from "../command-execution.type";
import { StampMetaOutput } from "../stamp-meta.type";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { WinShellService } from "src/activities/common/win-shell.service";
import { SourceAclError, TargetAclError } from "./acl-operation.error";
import { psGetAclScript, psSetAclScript } from "./powershell.script";
import { RedisService } from "src/redis/redis.service";
import { LRUCache } from "src/activities/core/utils/lru-cache";
import { OPS_CMD } from "@netapp-cloud-datamigrate/jobs-lib";



@Injectable()
export class WinOperationService {
    private readonly logger: LoggerService;
    private sidCache: LRUCache = new LRUCache(1000);

    constructor(
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
        private readonly winShellService: WinShellService,
        private readonly redisService: RedisService,
    ) {
        this.logger = loggerFactory.create(WinOperationService.name);
    }

    async getAclOperation(path: string, isSource: boolean): Promise<SecurityDescriptor> {
        try {
            const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetAclScript}`;
            const output = await this.winShellService.executeCommand(script);
            this.logger.log('acl-------------> ' + JSON.stringify(output));
            if(output.stderr) throw new Error(output.stderr);
            return JSON.parse(output.stdout) as SecurityDescriptor;
        } catch (error) {
            this.logger.error(`Failed to get ACL for ${path}: ${error.message}`);
            if (isSource) throw new SourceAclError(`Failed to get ACL for ${path}: ${error.message}`);
            else throw new TargetAclError(`Failed to get ACL for ${path}: ${error.message}`);
        }
    }
    
    async setAclOperation(targetPath: string, acl: SecurityDescriptor): Promise<any> {
        try {
            const aclJsonString = JSON.stringify(acl).replace(/'/g, "''");
            const script = `$dstFile = '${targetPath.replace(/'/g, "''")}'\n$aclJson = '${aclJsonString}'\n${psSetAclScript}`;
            const output = await this.winShellService.executeCommand(script);
            if(output.stderr) throw new Error(output.stderr);
            return output;
        } catch (error) {
            this.logger.error(`Failed to set ACL for ${targetPath}: ${error.message}`);
            throw new TargetAclError(`Failed to set ACL for ${targetPath}: ${error.message}`);
        }
    }

    async stampAclOperation({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<{ output: StampMetaOutput, errors: string[] }> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        let acl: SecurityDescriptor = await this.getAclOperation(sourcePath, true);
        this.logger.log(`Source ACL---------->: ${JSON.stringify(acl)}`);
        if(jobContext.jobConfig?.options?.isIdentityMappingAvailable){
            this.logger.log('Mapping SID to target: ' + jobContext.jobConfig?.options?.isIdentityMappingAvailable);
            acl = await this.mapSIDToTarget(acl, jobContext.jobRunId);
        }
        const errors: string[] = [];
        if(acl.Owner === 'Invalid'){
            errors.push(`Invalid Owner SID for ${acl.originalOwner} found in SID mapping`);
            acl.Owner= acl.originalOwner;
            delete acl.originalOwner;
        }

        if(acl.Group === 'Invalid'){
            errors.push(`Invalid Group SID for ${acl.originalGroup} found in SID mapping`);
            acl.Group = acl.originalGroup;
            delete acl.originalGroup;
        }
        if(acl.DaclAces) {
            acl.DaclAces.forEach((ace,index) => {
                if(ace.Sid === 'Invalid'){
                    errors.push(`Invalid ACL SID for ${ace.originalSid} found in SID mapping`);
                    acl.DaclAces.splice(index,1);
                }
            });
        }
        this.logger.log(`Mapped ACL---------->: ${JSON.stringify(acl)}`);
        const result = await this.setAclOperation(targetPath, acl);
        this.logger.log(`Set ACL Result: ${JSON.stringify(result)}`);
        this.logger.log(`Set ACL Result--->: ${result}`);
        if(result?.stdout && result.stdout.includes('unresolved_sids')){
            const unresolved_sids= JSON.parse(result.stdout)?.unresolved_sids;
            this.logger.log(`Unresolved SIDs: ${JSON.stringify(unresolved_sids)}`);
            if(unresolved_sids && unresolved_sids.length > 0){
                unresolved_sids.forEach(sid => {
                    errors.push(`Unresolved SID ${sid} found while setting ACL on target`);
                });
            }
        }

        let targetAcl: SecurityDescriptor = await this.getAclOperation(targetPath, false);
        this.logger.log(`Target ACL---------->: ${JSON.stringify(targetAcl)}`);
        
        const validation = await this.validateAclOperation(acl, targetAcl);
        if(validation.inValid.length > 0) 
           command.ops[OPS_CMD.STAMP_META].params.error = validation.inValid;
        command.ops[OPS_CMD.STAMP_META].params.sidMap = { targetAcl: validation.targetSID, sourceAcl: validation.sourceSID, validationError: validation.inValid };
        
        return {output, errors};
    }

    async getSIDMapping(sourceSid: string, jobRunId): Promise<string | null> {
        const cacheKey = `${jobRunId}:${sourceSid}`;
        const cached = this.sidCache.get(cacheKey);
        if (cached) return cached;
        const queried = await this.redisService.getOwnerIdentity(jobRunId, sourceSid, 'SID');
        this.logger.log(`Queried SID mapping from Redis: ${sourceSid} -> ${queried}`);
        if (queried) this.sidCache.put(cacheKey, queried);
        return queried;
    }

    async mapSIDToTarget(acl : SecurityDescriptor, jobRunId: string): Promise<SecurityDescriptor> {
        acl.originalOwner = acl.Owner;
        acl.originalGroup = acl.Group;
        const owner = await this.getSIDMapping(acl.Owner, jobRunId);
        if (owner) acl.Owner = owner;

        const group = await this.getSIDMapping(acl.Group, jobRunId);
        if (group) acl.Group = group;
        
        acl.DaclAces = await Promise.all(acl.DaclAces.map(async (ace) => {
            ace.originalSid = ace.Sid;
            const targetSid = await this.getSIDMapping(ace.Sid, jobRunId);
            this.logger.log(`Mapping SID ${ace.Sid} to ${targetSid}`);
            if (targetSid) ace.Sid = targetSid;
            return ace;
        }));
        return acl;
    }

    async resetFileAttributes(path: string): Promise<boolean> {
        try {
            await this.winShellService.executeCommand(`attrib -H -R "${path}"`);
            return true;
        } catch {
            throw new Error(`Failed to reset file attributes for ${path}`);
        }
    }

    async validateAclOperation(acl1: SecurityDescriptor, acl2: SecurityDescriptor) : Promise<ValidatorOutput> {
        const output: ValidatorOutput = { sourceSID: '', targetSID: '', inValid: '' };
        output.sourceSID = `Owner: ${acl1.Owner}, Group: ${acl1.Group},`;
        output.targetSID = `Owner: ${acl2.Owner}, Group: ${acl2.Group}, `;
        if(acl1.Owner !== acl2.Owner) output.inValid += `Owner mismatch: Expected(${acl1.Owner}) Target(${acl2.Owner}). `;
        if(acl1.Group !== acl2.Group) output.inValid += `Group mismatch: Expected(${acl1.Group}) Target(${acl2.Group}). `;

        const aceMap1 = new Map<string, Ace>();
        acl1.DaclAces.forEach(ace => {
            const key = `${ace.Sid}-${ace.AccessMask}-${ace.AceType}-${ace.AceFlags}`;
            aceMap1.set(key, ace);
            output.sourceSID += `ACE in source: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}), AceFlags(${ace.AceFlags}). `;
        });

        const aceMap2 = new Map<string, Ace>();
        acl2.DaclAces.forEach(ace => {
            const key = `${ace.Sid}-${ace.AccessMask}-${ace.AceType}-${ace.AceFlags}`;
            aceMap2.set(key, ace);
            output.targetSID += `ACE in target: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}), AceFlags(${ace.AceFlags}). `;
        });

        for (const [key, ace] of aceMap1) {
            if (!aceMap2.has(key)) {
                output.inValid += `Missing ACE in target: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}), AceFlags(${ace.AceFlags}). `;
            }
        }
        return output;
    }

    async resolveUsernamesToSids(usernames: string[]): Promise<Map<string, string>> {
        const usernameToSidMap = new Map<string, string>();
        const command = `Resolve-UsernamesToSid -Username ${usernames.join(',')}`;
        const output = await this.winShellService.executeCommand(command);
        const sidMappings = JSON.parse(output.stdout);
        this.logger.log(`Resolved SID mappings: ${JSON.stringify(sidMappings)}`);
        if(!Array.isArray(sidMappings) || sidMappings.length === 0) {
            usernameToSidMap.set(sidMappings?.username, sidMappings?.sid);
            return usernameToSidMap;
        }
        sidMappings.forEach(mapping => {
            usernameToSidMap.set(mapping.username, mapping.sid);
        });

        return usernameToSidMap;
    }
    
}