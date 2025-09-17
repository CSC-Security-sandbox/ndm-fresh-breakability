import { Inject, Injectable } from "@nestjs/common";
import { JobManagerContext } from "@netapp-cloud-datamigrate/jobs-lib";
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { ProtocolTypes } from "src/protocols/protocols";
import { RedisService } from "src/redis/redis.service";
import { WinOperationService } from "../migrate/command-execution/win-opeartions/win-operation.service";


@Injectable()
export class MappingResolverService {
    private readonly logger: LoggerService;
    constructor(
        @Inject(LoggerFactory) private readonly loggerFactory: LoggerFactory,
        private readonly redisService: RedisService,
        private readonly winOperationService: WinOperationService
    ) {
        this.logger = this.loggerFactory.create(MappingResolverService.name);
    }


    async resolveUsernamesToSids(jobRunId: string) {
        
        const jobContext: JobManagerContext = await this.redisService.getJobManagerContext(jobRunId);
        if (!jobContext.jobConfig?.destinationFileServer?.protocols[0]?.type.includes(ProtocolTypes.SMB) || !jobContext.jobConfig?.options?.isIdentityMappingAvailable) {
            this.logger.debug(`Identity mapping not available for jobRunId: ${jobRunId}`);
            return;
        }

        const sourceSID = await this.redisService.getMappingKeys(jobRunId, 'SID');
      
        for(let batchIdx = 0; batchIdx< sourceSID.length; batchIdx += 50) {
            const batch = sourceSID.slice(batchIdx, batchIdx + 50);
            const mapping = new Map<string, string>(), resolved = new Map<string, string>(); 
            
            await Promise.all(batch.map( async (sid) => {
                await this.redisService.getOwnerIdentity(jobRunId, sid, 'SID').then( username => {
                    mapping.set(sid, username);
                })
            }))
            
            const unresolvedSids: string[] = [];
            for(const [src, dst] of mapping) {
                let unresolved = false;
                if(!src.startsWith('S-')) 
                    unresolvedSids.push(src), unresolved = true;
                if(!dst.startsWith('S-')) 
                    unresolvedSids.push(dst), unresolved = true;
                if(unresolved)
                    resolved.set(src, dst);
            }

            mapping.clear();
            if(unresolvedSids.length === 0) continue;
            const mappedSids = await this.winOperationService.resolveUsernamesToSids(unresolvedSids);

            for(const [src, dst] of resolved) {
                const sourceSid = src && src.startsWith('S-') ? src : mappedSids.get(src);
                const targetSid = dst && dst.startsWith('S-') ? dst : mappedSids.get(dst);
                await this.redisService.setOwnerIdentity(jobRunId, sourceSid, 'SID', targetSid);
            }
        }
    }
}