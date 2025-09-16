import { Inject, Injectable } from "@nestjs/common";
import { CommandExecInput } from "../command-execution.type";
import { StampMetaOutput } from "../stamp-meta.type";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { WinShellService } from "src/activities/common/win-shell.serive";
import { SrcACLReadError, TgtACLWriteError } from "./acl-operation.error";
import { psGetAclScript, psSetAclScript } from "./powershell.script";
import { RedisService } from "src/redis/redis.service";
import { LRUCache } from "src/activities/core/utils/lru-cache";


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

    async getAclOperation(sourcePath: string): Promise<SecurityDescriptor> {
        try {
            const script = `$srcFile = '${sourcePath.replace(/'/g, "''")}'\n${psGetAclScript}`;
            const output = await this.winShellService.executeCommand(script);
            if(output.stderr) throw new Error(output.stderr);
            return JSON.parse(output.stdout) as SecurityDescriptor;
        } catch (error) {
            this.logger.error(`Failed to get ACL for ${sourcePath}: ${error.message}`);
            throw new SrcACLReadError(`Failed to get ACL for ${sourcePath}: ${error.message}`);
        }
    }

    async setAclOperation(targetPath: string, acl: SecurityDescriptor): Promise<void> {
        try {
            const aclJsonString = JSON.stringify(acl).replace(/'/g, "''");
            const script = `$dstFile = '${targetPath.replace(/'/g, "''")}'\n$aclJson = '${aclJsonString}'\n${psSetAclScript}`;
            const output = await this.winShellService.executeCommand(script);
            if(output.stderr) throw new Error(output.stderr);
        } catch (error) {
            this.logger.error(`Failed to set ACL for ${targetPath}: ${error.message}`);
            throw new TgtACLWriteError(`Failed to set ACL for ${targetPath}: ${error.message}`);
        }
    }

    async stampAclOperation({command, jobContext, sourcePath, targetPath, errorType}: CommandExecInput): Promise<StampMetaOutput> {
        const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
        let acl: SecurityDescriptor = await this.getAclOperation(sourcePath);

        if(jobContext.jobConfig?.options?.isIdentityMappingAvailable)
            acl = await this.mapSIDToTarget(acl, jobContext.jobRunId);

        await this.setAclOperation(targetPath, acl);
        return output;
    }

    async getSIDMapping(sourceSid: string, jobRunId): Promise<string | null> {
        const cacheKey = `${jobRunId}:${sourceSid}`;
        const cached = this.sidCache.get(cacheKey);
        if (cached) return cached;
        const queried = await this.redisService.getOwnerIdentity(jobRunId, sourceSid, 'SID');
        if (queried) this.sidCache.put(cacheKey, queried);
        return queried;
    }

    async mapSIDToTarget(acl : SecurityDescriptor, jobRunId: string): Promise<SecurityDescriptor> {
        const owner = await this.getSIDMapping(acl.Owner, jobRunId);
        if (owner) acl.Owner = owner;

        const group = await this.getSIDMapping(acl.Group, jobRunId);
        if (group) acl.Group = group;
        
        acl.DaclAces = await Promise.all(acl.DaclAces.map(async (ace) => {
            const targetSid = await this.getSIDMapping(ace.Sid, jobRunId);
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

    
}