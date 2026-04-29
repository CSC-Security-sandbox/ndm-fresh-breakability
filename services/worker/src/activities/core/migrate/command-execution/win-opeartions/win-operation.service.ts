import { Inject, Injectable } from '@nestjs/common';
import { CommandExecInput } from '../command-execution.type';
import { StampMetaOutput } from '../stamp-meta.type';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { WinShellService } from 'src/activities/common/win-shell.service';
import { SourceAclError, TargetAclError, WindowsAPINotAvailableError } from './acl-operation.error';
import { psGetAclScript, psSetAclScript, psGetLinkInfoScript } from './powershell.script';
import { RedisService } from 'src/redis/redis.service';
import { LRUCache } from 'src/activities/core/utils/lru-cache';
import { Cmd, ErrorType, JobManagerContext, OPS_CMD } from '@netapp-cloud-datamigrate/jobs-lib';
import { MetricsService } from 'src/metrics/metrics.service';
import { FileType } from 'src/activities/types/tasks';
import * as koffi from 'koffi';
import { Operation, Origin } from 'src/activities/utils/utils.types';
import { dmError } from 'src/activities/utils/utils';

// Windows API initialization for ADS detection
let FindFirstStreamW: any;
let FindNextStreamW: any;
let FindClose: any;
let WIN32_FIND_STREAM_DATA: any;



@Injectable()
export class WinOperationService {
  private readonly logger: LoggerService;
  private sidCache: LRUCache = new LRUCache(1000);

  private readonly ADS_SUFFIX = ':$DATA';
  private readonly DEFAULT_STREAM = '::$DATA';
  private hasWindowsAPIs:boolean = true;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly winShellService: WinShellService,
    private readonly redisService: RedisService,
    private readonly metricsService: MetricsService,
  ) {
    this.logger = loggerFactory.create(WinOperationService.name);
    if(process.platform === 'win32'){
      this.initializeWindowsAPI();
    }
      
  }

  initializeWindowsAPI() {
    if (FindFirstStreamW) return; // Already initialized

    try {
      const kernel32 = koffi.load('kernel32.dll');

      // Define WIN32_FIND_STREAM_DATA structure
      WIN32_FIND_STREAM_DATA = koffi.struct('WIN32_FIND_STREAM_DATA', {
        StreamSize: 'int64',
        cStreamName: koffi.array('uint16', 296)
      });

      // Define Windows API functions
      FindFirstStreamW = kernel32.func('FindFirstStreamW', 'void *', [
        'str16', 'int', koffi.pointer(WIN32_FIND_STREAM_DATA), 'uint32'
      ]);
      FindNextStreamW = kernel32.func('FindNextStreamW', 'bool', [
        'void *', koffi.pointer(WIN32_FIND_STREAM_DATA)
      ]);
      FindClose = kernel32.func('FindClose', 'bool', ['void *']);
    } catch (error) {
      // If Windows API initialization fails, functions will remain undefined
      console.error('Failed to initialize Windows API for ADS detection:', error);
    }
  }

  async getAclOperation(
    path: string,
    isSource: boolean,
    workflowId = '',
  ): Promise<SecurityDescriptor> {
    try {
      const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetAclScript}`;
      const output = await this.winShellService.executeCommand(script, workflowId);
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
    workflowId = '',
  ): Promise<any> {
    try {
      const aclJsonString = JSON.stringify(acl).replace(/'/g, "''");
      const script = `$dstFile = '${targetPath.replace(/'/g, "''")}'\n$aclJson = '${aclJsonString}'\n${psSetAclScript}`;
      const output = await this.winShellService.executeCommand(script, workflowId);
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
    const workflowId = jobContext?.jobRunId ?? '';

    // 1. Get source ACL (PowerShell Get-Acl)
    let acl: SecurityDescriptor = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_get_source' },
      () => this.getAclOperation(sourcePath, true, workflowId),
    );
    this.logger.debug(`Fetched source ACL for ${sourcePath}: ${JSON.stringify(acl)}`);

    // 2. SID mapping (Redis lookups)
    if (jobContext.jobConfig?.options?.isIdentityMappingAvailable) {
      this.logger.log(
        'Mapping SID to target: ' +
        jobContext.jobConfig?.options?.isIdentityMappingAvailable,
      );
      acl = await this.metricsService.runWithTiming(
        workflowId,
        { category: 'stamp_phase', phase: 'acl_sid_mapping' },
        () => this.mapSIDToTarget(acl, jobContext.jobRunId),
      );
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

    // 3. Set target ACL (PowerShell Set-FileSecurityFast)
    const result = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_set_target' },
      () => this.setAclOperation(targetPath, acl, workflowId),
    );

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

    // 4. Get target ACL (PowerShell Get-Acl for validation)
    let targetAcl: SecurityDescriptor = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_get_target' },
      () => this.getAclOperation(targetPath, false, workflowId),
    );

    this.logger.debug(`Fetched target ACL for ${targetPath}: ${JSON.stringify(targetAcl)}`);

    // 5. Validate ACL (compare source vs target)
    const validation = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_validate' },
      () => this.validateAclOperation(acl, targetAcl),
    );
    if (validation.inValid.length > 0){
      command.ops[OPS_CMD.STAMP_META].params.error = validation.inValid;
    }
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

    // Parallelize owner, group, and all ACE SID lookups in a single batch
    const [owner, group] = await Promise.all([
      this.getSIDMapping(acl.Owner, jobRunId),
      this.getSIDMapping(acl.Group, jobRunId),
    ]);
    if (owner) acl.Owner = owner;
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

    if (Array.isArray(sidMappings)) {
      for (const mapping of sidMappings) {
        if (mapping?.username && mapping?.sid) {
          usernameToSidMap.set(mapping.username, mapping.sid);
        }
      }
      return usernameToSidMap;
    }

    if (sidMappings?.username && sidMappings?.sid) {
      usernameToSidMap.set(sidMappings.username, sidMappings.sid);
    }
    return usernameToSidMap;
  }

  async detectSymbolicLinkType(path: string): Promise<FileType> {
    try {
      const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetLinkInfoScript}`;
      const output = await this.winShellService.executeCommand(script);
      if (output.stderr) throw new Error(output.stderr);
      const result = JSON.parse(output.stdout);

      this.logger.debug(`Parsed link detection result for path ${path} is : ${JSON.stringify(result, null, 2)}`);

      if (result.IsJunction) return FileType.JUNCTION;
      if (result.IsSymbolicLink) return FileType.SYMBOLIC_LINK;
      if (result.IsVolumeMountPoint) return FileType.VOLUME_MOUNT_POINT;
      return FileType.UNKNOWN;
    } catch (error) {
      this.logger.error(`Failed to detect symbolic link for ${path}: ${error.message}`);
      return FileType.UNKNOWN;
    }
  }

  private decodeStreamName(raw: Uint16Array): string {
    let result = '';
    for (const code of raw) {
      if (code === 0) break;
      result += String.fromCharCode(code);
    }
    return result;
  }

  private extractADSName(streamName: string): string | null {
    if (
      !streamName.startsWith(':') ||
      !streamName.endsWith(this.ADS_SUFFIX)
    ) {
      return null;
    }

    const name = streamName.slice(1, -this.ADS_SUFFIX.length);
    return name.length > 0 ? name : null;
  }


  async detectADSInfo(jobContext: JobManagerContext, command: Cmd, filePath: string): Promise<ADSInfo> {
    const defaultResult: ADSInfo = {
      hasADS: false,
      streamCount: 0,
      streamNames: [],
      streamSizes: [],
      totalSize: 0
    };
    if(!this.hasWindowsAPIs){
      return defaultResult;
    }
    
    try {
     // Throw transient error if Windows API not available
      if (!FindFirstStreamW || !FindNextStreamW || !FindClose) {      
        this.hasWindowsAPIs = false;
        throw new WindowsAPINotAvailableError();
      }
      const streamData = koffi.alloc(WIN32_FIND_STREAM_DATA, 1);
      const INVALID_HANDLE = -1;
      const handle = FindFirstStreamW(filePath, 0, streamData, 0);

      if (handle === INVALID_HANDLE || handle === null || handle === 0) {
        return defaultResult;
      }

      const streamNames: string[] = [];
      const streamSizes: number[] = [];
      let totalSize = 0;

      try {
        // Pre-allocate buffer for string conversion to avoid repeated allocations   
        let hasMoreStreams = true;
        while (hasMoreStreams) {
          const data = koffi.decode(streamData, WIN32_FIND_STREAM_DATA);
          const streamSize = Number(data.StreamSize);
          const streamName = this.decodeStreamName(data.cStreamName);
          if (!streamName) {
            this.logger.warn(`Empty stream name detected for file:  ${filePath}`);
            break;
          }

          if (streamName && streamName !== this.DEFAULT_STREAM) {
            const extractedName = this.extractADSName(streamName);
            if (extractedName) {
              streamNames.push(extractedName);
              streamSizes.push(streamSize);
              totalSize += streamSize;
            }
          }
          hasMoreStreams = FindNextStreamW(handle, streamData);

        }
      } finally {
        FindClose(handle);
      }

      return {
        hasADS: streamNames.length > 0,
        streamCount: streamNames.length,
        streamNames,
        streamSizes,
        totalSize
      };
    } catch (error) {
      if(error instanceof WindowsAPINotAvailableError){       
        const dmErr = dmError("OPERATION", Origin.SOURCE, Operation.READ_DIR, ErrorType.TRANSIENT_ERROR, command.id, error, {name: command.fPath, path: filePath});
        await jobContext.publishToErrorStream(dmErr, jobContext.jobConfig?.jobRunId);  
      }
      // Log error but don't throw - ADS detection failure shouldn't break the scan
      this.logger.error(`Exception during ADS detection for ${filePath}: ${error.message}`, error.stack);
      return defaultResult;
    }
  }
}
