import { Inject, Injectable } from '@nestjs/common';
import { CommandExecInput } from '../command-execution.type';
import { StampMetaOutput } from '../stamp-meta.type';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { SourceAclError, TargetAclError } from './acl-operation.error';
import { psGetAclScript, psSetAclScript, psGetLinkInfoScript } from './powershell.script';
import { RedisService } from 'src/redis/redis.service';
import { LRUCache } from 'src/activities/core/utils/lru-cache';
import { OPS_CMD } from '@netapp-cloud-datamigrate/jobs-lib';
import { FileType } from 'src/activities/types/tasks';

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

  async getAclOperation(
    path: string,
    isSource: boolean,
  ): Promise<SecurityDescriptor> {
    try {
      const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetAclScript}`;
      const output = await this.winShellService.executeCommand(script);
      if (output.stderr) throw new Error(output.stderr);
      return JSON.parse(output.stdout) as SecurityDescriptor;
    } catch (error) {
      this.logger.error(`Failed to get ACL for ${path}: ${error.message}`);
      if (isSource)
        throw new SourceAclError(
          `Failed to get ACL for ${path}: ${error.message}`,
        );
      else
        throw new TargetAclError(
          `Failed to get ACL for ${path}: ${error.message}`,
        );
    }
  }

  async setAclOperation(
    targetPath: string,
    acl: SecurityDescriptor,
  ): Promise<any> {
    try {
      const aclJsonString = JSON.stringify(acl).replace(/'/g, "''");
      const script = `$dstFile = '${targetPath.replace(/'/g, "''")}'\n$aclJson = '${aclJsonString}'\n${psSetAclScript}`;
      const output = await this.winShellService.executeCommand(script);
      if (output.stderr) throw new Error(output.stderr);
      return output;
    } catch (error) {
      this.logger.error(
        `Failed to set ACL for ${targetPath}: ${error.message}`,
      );
      throw new TargetAclError(
        `Failed to set ACL for ${targetPath}: ${error.message}`,
      );
    }
  }

  async stampAclOperation({
    command,
    jobContext,
    sourcePath,
    targetPath,
    errorType,
  }: CommandExecInput): Promise<{ output: StampMetaOutput; errors: string[] }> {
    const output: StampMetaOutput = { sourceErrors: [], targetErrors: [] };
    let acl: SecurityDescriptor = await this.getAclOperation(sourcePath, true);
    if (jobContext.jobConfig?.options?.isIdentityMappingAvailable) {
      this.logger.log(
        'Mapping SID to target: ' +
          jobContext.jobConfig?.options?.isIdentityMappingAvailable,
      );
      acl = await this.mapSIDToTarget(acl, jobContext.jobRunId);
    }
    const errors: string[] = [];
    if (acl.Owner === 'Invalid') {
      errors.push(
        `Invalid Owner SID for ${acl.originalOwner} found in SID mapping`,
      );
      acl.Owner = acl.originalOwner;
      delete acl.originalOwner;
    }

    if (acl.Group === 'Invalid') {
      errors.push(
        `Invalid Group SID for ${acl.originalGroup} found in SID mapping`,
      );
      acl.Group = acl.originalGroup;
      delete acl.originalGroup;
    }
    if (acl.DaclAces) {
      acl.DaclAces = acl.DaclAces.filter((ace) => {
        if (ace.Sid === 'Invalid') {
          errors.push(
            `Invalid ACL SID for ${ace.originalSid} found in SID mapping`,
          );
          return false;
        }
        return true;
      });
    }
    const result = await this.setAclOperation(targetPath, acl);

    if (result?.stdout && result.stdout.includes('unresolved_sids')) {
      const unresolved_sids = JSON.parse(result.stdout)?.unresolved_sids;
      if (unresolved_sids && unresolved_sids.length > 0) {
        unresolved_sids.forEach((sid) => {
          errors.push(
            `Unresolved SID ${sid} found while setting ACL on target`,
          );
        });
      }
    }

    let targetAcl: SecurityDescriptor = await this.getAclOperation(
      targetPath,
      false,
    );

    const validation = await this.validateAclOperation(acl, targetAcl);
    if (validation.inValid.length > 0)
      command.ops[OPS_CMD.STAMP_META].params.error = validation.inValid;
    command.ops[OPS_CMD.STAMP_META].params.sidMap = {
      targetAcl: validation.targetSID,
      sourceAcl: validation.sourceSID,
      validationError: validation.inValid,
    };

    return { output, errors };
  }

  async getSIDMapping(sourceSid: string, jobRunId): Promise<string | null> {
    const cacheKey = `${jobRunId}:${sourceSid}`;
    const cached = this.sidCache.get(cacheKey);
    if (cached) return cached;
    const queried = await this.redisService.getOwnerIdentity(
      jobRunId,
      sourceSid,
      'SID',
    );
    this.logger.debug(
      `Queried SID mapping from Redis: ${sourceSid} -> ${queried}`,
    );
    if (queried) this.sidCache.put(cacheKey, queried);
    return queried;
  }

  async mapSIDToTarget(
    acl: SecurityDescriptor,
    jobRunId: string,
  ): Promise<SecurityDescriptor> {
    acl.originalOwner = acl.Owner;
    acl.originalGroup = acl.Group;
    const owner = await this.getSIDMapping(acl.Owner, jobRunId);
    if (owner) acl.Owner = owner;

    const group = await this.getSIDMapping(acl.Group, jobRunId);
    if (group) acl.Group = group;

    acl.DaclAces = await Promise.all(
      acl.DaclAces.map(async (ace) => {
        ace.originalSid = ace.Sid;
        const targetSid = await this.getSIDMapping(ace.Sid, jobRunId);
        this.logger.debug(`Mapping SID ${ace.Sid} to ${targetSid}`);
        if (targetSid) ace.Sid = targetSid;
        return ace;
      }),
    );
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

  async validateAclOperation(
    acl1: SecurityDescriptor,
    acl2: SecurityDescriptor,
  ): Promise<ValidatorOutput> {
    const output: ValidatorOutput = {
      sourceSID: '',
      targetSID: '',
      inValid: '',
    };
    output.sourceSID = `Owner: ${acl1.Owner}, Group: ${acl1.Group},`;
    output.targetSID = `Owner: ${acl2.Owner}, Group: ${acl2.Group}, `;
    if (acl1.Owner !== acl2.Owner)
      output.inValid += `Owner mismatch: Expected(${acl1.Owner}) Target(${acl2.Owner}). `;
    if (acl1.Group !== acl2.Group)
      output.inValid += `Group mismatch: Expected(${acl1.Group}) Target(${acl2.Group}). `;

    // Only consider AccessAllowed (0) and AccessDenied (1) ACEs in comparison.
    // This ignores audit/object ACEs (e.g., AceType 3, 5) which are not stamped or relevant for access control.
    // This prevents false errors for ACEs that cannot be set or are not part of DACL.
    const sourceAcls = (acl1.DaclAces || []).filter(
      (ace) => ace.AceType === 0 || ace.AceType === 1,
    );
    sourceAcls.forEach((ace) => {
      output.sourceSID += `ACE in source: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}). `;
    });

    const targetAcls = (acl2.DaclAces || []).filter(
      (ace) => ace.AceType === 0 || ace.AceType === 1,
    );
    targetAcls.forEach((ace) => {
      output.targetSID += `ACE in target: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}). `;
    });

    // For each source ACE, check if any target ACE with same SID and AceType has all required AccessMask bits
    // For S-1-3-0 (Creator Owner), only require SID and AceType match, ignore AccessMask
    for (const srcAce of sourceAcls) {
      if (srcAce.Sid === 'S-1-3-0') {
        const found = targetAcls.some(
          (tgtAce) =>
            tgtAce.Sid === srcAce.Sid && tgtAce.AceType === srcAce.AceType,
        );
        if (!found) {
          output.inValid += `Missing ACE in target: SID(${srcAce.Sid}), AceType(${srcAce.AceType}). `;
        }
      } else {
        const matchingTargetAces = targetAcls.filter(
          (tgtAce) =>
            tgtAce.Sid === srcAce.Sid && tgtAce.AceType === srcAce.AceType,
        );
        const found = matchingTargetAces.some(
          (tgtAce) =>
            (tgtAce.AccessMask & srcAce.AccessMask) === srcAce.AccessMask,
        );
        if (!found) {
          output.inValid += `Missing ACE in target: SID(${srcAce.Sid}), AccessMask(${srcAce.AccessMask}), AceType(${srcAce.AceType}). `;
        }
      }
    }
    return output;
  }

  async resolveUsernamesToSids(
    usernames: string[],
  ): Promise<Map<string, string>> {
    const usernameToSidMap = new Map<string, string>();
    const command = `Resolve-UsernamesToSid -Username ${usernames.join(',')}`;
    const output = await this.winShellService.executeCommand(command);
    const sidMappings = JSON.parse(output.stdout);
    if (!Array.isArray(sidMappings) || sidMappings.length === 0) {
      usernameToSidMap.set(sidMappings?.username, sidMappings?.sid);
      return usernameToSidMap;
    }
    sidMappings.forEach((mapping) => {
      usernameToSidMap.set(mapping.username, mapping.sid);
    });

    return usernameToSidMap;
  }

  async detectSymbolicLinkType(path: string): Promise<FileType> {
    try {
      const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetLinkInfoScript}`;
      const output = await this.winShellService.executeCommand(script);
      if (output.stderr) throw new Error(output.stderr);
      const result = JSON.parse(output.stdout);

      if (result.IsJunction) return FileType.JUNCTION;
      if (result.IsSymbolicLink) return FileType.SYMBOLIC_LINK;
      return FileType.UNKNOWN;
    } catch (error) {
      this.logger.error(`Failed to detect symbolic link for ${path}: ${error.message}`);
      return FileType.UNKNOWN;
    }
  }
}
