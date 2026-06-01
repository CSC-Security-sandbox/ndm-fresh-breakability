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
import { parseStampableAttributes } from './file-attributes';

export enum SmbPermissionInheritanceMode {
  INHERIT_PERMS_AS_IS       = 'INHERIT_PERMS_AS_IS',
  INHERIT_PERMS_AS_EXPLICIT = 'INHERIT_PERMS_AS_EXPLICIT',
}

// Windows API initialization for ADS detection
let FindFirstStreamW: any;
let FindNextStreamW: any;
let FindClose: any;
let WIN32_FIND_STREAM_DATA: any;
let GetFileAttributesW: any;

@Injectable()
export class WinOperationService {
  private readonly logger: LoggerService;
  private sidCache: LRUCache = new LRUCache(1000);

  private readonly ADS_SUFFIX = ':$DATA';
  private readonly DEFAULT_STREAM = '::$DATA';
  private readonly FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
  private readonly INVALID_FILE_ATTRIBUTES = 0xffffffff;
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
      GetFileAttributesW = kernel32.func('GetFileAttributesW', 'uint32', ['str16']);
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
      const parsed = JSON.parse(output.stdout);
      this.forwardGetAclScriptLogs(parsed, workflowId, path, isSource);
      return parsed as SecurityDescriptor;
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
      this.forwardSetAclScriptLogs(output?.stdout, workflowId, targetPath);
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

  /**
   * Forward the diagnostic `logs` array that `Set-FileSecurityFast` packs
   * into its stdout JSON to the worker logger so each PowerShell-side
   * decision (parsed SD, NULL-DACL branch, computed control flags, kernel
   * call result, attribute apply) shows up as a normal info line keyed to
   * the same `workflowId` and `targetPath` as the surrounding TS logs.
   *
   * Silent on non-JSON stdout or absent/non-array `logs` — keeps this safe
   * to call against any historical PowerShell payload shape and against
   * any future stdout shape change without breaking the stamp path.
   */
  private forwardSetAclScriptLogs(
    stdout: string | undefined,
    workflowId: string,
    targetPath: string,
  ): void {
    if (!stdout) return;
    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return;
    }
    if (!Array.isArray(parsed?.logs)) return;
    for (const line of parsed.logs) {
      this.logger.log(
        `[${workflowId}] [Set-FileSecurityFast] ${line} targetPath=${targetPath}`,
      );
    }
  }

  private forwardGetAclScriptLogs(
    parsed: any,
    workflowId: string,
    path: string,
    isSource: boolean,
  ): void {
    if (!Array.isArray(parsed?.logs)) return;
    const tag = isSource ? 'Get-FileSecurityFast:SRC' : 'Get-FileSecurityFast:DST';
    for (const line of parsed.logs) {
      this.logger.log(`[${workflowId}] [${tag}] ${line} path=${path}`);
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

    // 2c. Apply SMB inheritance mode for the DLM root (no-op for all other commands).
    const filteredAcl = this.applySmbInheritanceMode(acl, command, jobContext);

    this.logger.log(
      `[${workflowId}] Stamping ACL on destination handed to Set-FileSecurityFast - targetPath=${targetPath} ` +
      `sourcePath=${sourcePath} ` +
      `sd=${JSON.stringify(filteredAcl)}`,
    );

    // 3. Set target ACL (PowerShell Set-FileSecurityFast)
    const result = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_set_target' },
      () => this.setAclOperation(targetPath, filteredAcl, workflowId),
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

    // 5. Validate ACL (compare source vs target).
    const validation = await this.metricsService.runWithTiming(
      workflowId,
      { category: 'stamp_phase', phase: 'acl_validate' },
      () => this.validateAclOperation(filteredAcl, targetAcl, { workflowId, sourcePath, targetPath }),
    );
    if (validation.inValid.length > 0) {
      command.ops[OPS_CMD.STAMP_META].params.error = validation.inValid;
      errors.push(`ACL post-stamp validation mismatch: ${validation.inValid}`);
    }
    // Build CoC header from the ORIGINAL (non-filtered) source ACL so the audit shows
    // the source's actual Owner/Group regardless of inheritance-mode filtering.
    const sourceSidString = `Owner: ${acl.originalOwner ?? acl.Owner}, Group: ${acl.originalGroup ?? acl.Group},${validation.sourceSID}`;
    const targetSidString = `Owner: ${targetAcl.Owner}, Group: ${targetAcl.Group}, ${validation.targetSID}`;
    command.ops[OPS_CMD.STAMP_META].params.sidMap = {
      targetAcl: targetSidString,
      sourceAcl: sourceSidString,
      validationError: validation.inValid,
    };
    this.logger.debug(`sidMap stored - sourceAcl: "${sourceSidString}" | targetAcl: "${targetSidString}"`);
    
    return { output, errors };
  }

  /**
   * Resolve the configured inheritance mode for a job, defaulting to
   * `INHERIT_PERMS_AS_EXPLICIT` when none is set. Shared by stamp and the
   * scan-time comparison gate so the two paths can't drift on the default.
   */
  resolveSmbInheritanceMode(jobContext?: JobManagerContext): SmbPermissionInheritanceMode {
    return ((jobContext?.jobConfig?.options as any)?.smbPermissionInheritanceMode
      ?? SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT) as SmbPermissionInheritanceMode;
  }

  /**
   * Pure transform — applies the configured inheritance mode to a security
   * descriptor's DACL. Caller is responsible for deciding *when* to invoke
   * this (DLM root only in both stamp and gate paths).
   *
   *   - `INHERIT_PERMS_AS_EXPLICIT`: flip inherited ACEs to explicit
   *     (clear `IsInherited`, clear `INHERITED_ACE` bit `0x10`).
   *   - `INHERIT_PERMS_AS_IS` (and any unknown mode): drop inherited ACEs.
   *
   * Returns the input unchanged when `DaclAces` is absent. Does not mutate.
   */
  applySmbInheritanceModeTransform(
    acl: SecurityDescriptor,
    mode: SmbPermissionInheritanceMode,
  ): SecurityDescriptor {
    if (!acl.DaclAces) return acl;

    if (mode === SmbPermissionInheritanceMode.INHERIT_PERMS_AS_EXPLICIT) {
      return {
        ...acl,
        DaclAces: acl.DaclAces.map(ace =>
          ace.IsInherited
            ? { ...ace, IsInherited: false, AceFlags: (ace.AceFlags ?? 0) & ~0x10 }
            : ace,
        ),
      };
    }

    return { ...acl, DaclAces: acl.DaclAces.filter(ace => !ace.IsInherited) };
  }

  /**
   * Stamp-path wrapper: applies the inheritance-mode transform iff the
   * command was flagged by `initDlmRootStamp` as the DLM root. Non-root
   * commands pass through unchanged.
   */
  applySmbInheritanceMode(
    acl: SecurityDescriptor,
    command: Cmd,
    jobContext: JobManagerContext,
  ): SecurityDescriptor {
    this.logger.log(`applySmbInheritanceMode: ${JSON.stringify(command.ops[OPS_CMD.STAMP_META]?.params.applyInheritanceMode)}`);
    if (!command.ops[OPS_CMD.STAMP_META]?.params.applyInheritanceMode) return acl;
    return this.applySmbInheritanceModeTransform(acl, this.resolveSmbInheritanceMode(jobContext));
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
    sourceAcl: SecurityDescriptor,
    jobRunId: string,
  ): Promise<SecurityDescriptor> {
    const sourceDaclAces = sourceAcl.DaclAces ?? [];
    const [mappedOwnerSid, mappedGroupSid, mappedDaclAces] = await Promise.all([
      this.getSIDMapping(sourceAcl.Owner, jobRunId),
      this.getSIDMapping(sourceAcl.Group, jobRunId),
      Promise.all(
        sourceDaclAces.map(async (sourceAce) => {
          const mappedAceSid = await this.getSIDMapping(sourceAce.Sid, jobRunId);
          this.logger.debug(`Mapping SID ${sourceAce.Sid} to ${mappedAceSid}`);
          return {
            ...sourceAce,
            originalSid: sourceAce.Sid,
            Sid: mappedAceSid ?? sourceAce.Sid,
          };
        }),
      ),
    ]);

    return {
      ...sourceAcl,
      originalOwner: sourceAcl.Owner,
      originalGroup: sourceAcl.Group,
      Owner: mappedOwnerSid ?? sourceAcl.Owner,
      Group: mappedGroupSid ?? sourceAcl.Group,
      DaclAces: mappedDaclAces,
    };
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
    sourceAcl: SecurityDescriptor,
    targetAcl: SecurityDescriptor,
    logContext?: { workflowId?: string; sourcePath?: string; targetPath?: string },
  ): Promise<ValidatorOutput> {
    const output: ValidatorOutput = {
      sourceSID: '',
      targetSID: '',
      inValid: '',
    };
    if (sourceAcl.Owner !== targetAcl.Owner)
      output.inValid += `Owner mismatch: Expected(${sourceAcl.Owner}) Target(${targetAcl.Owner}). `;
    if (sourceAcl.Group !== targetAcl.Group)
      output.inValid += `Group mismatch: Expected(${sourceAcl.Group}) Target(${targetAcl.Group}). `;


    if (!!sourceAcl.DaclPresent !== !!targetAcl.DaclPresent)
      output.inValid += `DaclPresent mismatch: Expected(${!!sourceAcl.DaclPresent}) Target(${!!targetAcl.DaclPresent}). `;
    if (!!sourceAcl.DaclProtected !== !!targetAcl.DaclProtected)
      output.inValid += `DaclProtected mismatch: Expected(${!!sourceAcl.DaclProtected}) Target(${!!targetAcl.DaclProtected}). `;

    // NULL DACL on both sides → there is no DACL to compare ACE-by-ACE on
    // either object (Win32 `SE_DACL_PRESENT=0` means access checks bypass
    // the DACL entirely). Walking `DaclAces` here is not just wasted work —
    // it's actively wrong: the reader sometimes surfaces phantom inherited
    // ACE bytes the kernel keeps around even after `SE_DACL_PRESENT` is
    // cleared, which would otherwise drive false-positive
    // "Missing ACE in target" findings on every incremental scan.
    //
    // Owner / Group / DaclPresent / DaclProtected / Attributes were already
    // checked above and stand on their own; we still log Source/Target SID
    // strings (empty here, by definition) for CoC parity.
    if (!sourceAcl.DaclPresent && !targetAcl.DaclPresent) {
      if (output.inValid.length > 0) {
        this.logger.log(
          `[${logContext?.workflowId ?? ''}] ACL post-stamp validation mismatch (NULL DACL both sides; ACE walk skipped) - ` +
          `sourcePath=${logContext?.sourcePath ?? ''} targetPath=${logContext?.targetPath ?? ''} ` +
          `inValid="${output.inValid.trim()}" ` +
          `sourceSd=${JSON.stringify(sourceAcl)} ` +
          `destinationSd=${JSON.stringify(targetAcl)}`,
        );
      }
      return output;
    }
    // `DaclAutoInherit` is intentionally NOT validated. Windows'
    // inheritance engine sets/clears this bit on its own, so the value
    // we read back is not guaranteed to equal what we wrote even on a
    // successful stamp. Validating it would generate false-positive
    // post-stamp errors. Symmetric with `securityDescriptorEquals`.

    // Attributes are compared on the stampable subset only — same mask the
    // stamp pipeline can actually write. Bits outside this subset
    // (Compressed, Encrypted, SparseFile, etc.) require separate Win32
    // syscalls that NDM does not invoke, so flagging them here would
    // alarm on every stamp without giving the operator anything to act on.
    const expectedAttrs = parseStampableAttributes(sourceAcl.Attributes);
    const actualAttrs   = parseStampableAttributes(targetAcl.Attributes);
    if (expectedAttrs !== actualAttrs)
      output.inValid += `Attributes mismatch: Expected(0x${expectedAttrs.toString(16)}) Target(0x${actualAttrs.toString(16)}). `;

    // Only consider AccessAllowed (0) and AccessDenied (1) ACEs in comparison.
    // This ignores audit/object ACEs (e.g., AceType 3, 5) which are not stamped or relevant for access control.
    // This prevents false errors for ACEs that cannot be set or are not part of DACL.
    const sourceAcls = (sourceAcl.DaclAces || []).filter(
      (ace) => ace.AceType === 0 || ace.AceType === 1,
    );
    sourceAcls.forEach((ace) => {
      output.sourceSID += `ACE in source: SID(${ace.originalSid ?? ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}). `;
    });

    const targetAcls = (targetAcl.DaclAces || []).filter(
      (ace) => ace.AceType === 0 || ace.AceType === 1,
    );
    targetAcls.forEach((ace) => {
      output.targetSID += `ACE in target: SID(${ace.Sid}), AccessMask(${ace.AccessMask}), AceType(${ace.AceType}). `;
    });

    // For each source ACE, check if any target ACE with same SID and AceType has all required AccessMask bits
    // and an exactly equal AceFlags byte (AceFlags packs inheritance shape: OBJECT_INHERIT 0x01,
    // CONTAINER_INHERIT 0x02, NO_PROPAGATE 0x04, INHERIT_ONLY 0x08, INHERITED_ACE 0x10 — drift here
    // silently changes propagation; strict equality implicitly covers IsInherited which mirrors bit 0x10).
    // For S-1-3-0 (Creator Owner), only require SID and AceType match, ignore AccessMask and AceFlags.
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
            (tgtAce.AccessMask & srcAce.AccessMask) === srcAce.AccessMask &&
            tgtAce.AceFlags === srcAce.AceFlags,
        );
        if (!found) {
          output.inValid += `Missing ACE in target: SID(${srcAce.Sid}), AccessMask(${srcAce.AccessMask}), AceType(${srcAce.AceType}), AceFlags(0x${(srcAce.AceFlags ?? 0).toString(16)}). `;
        }
      }
    }

    // Operator-facing: when post-stamp validation finds drift, dump the full
    // source and destination security descriptors so the operator can diff
    // them directly from logs without re-fetching from disk. `sourceAcl`
    // here is the *post-mapping, post-inheritance-transform* descriptor
    // (i.e., what stamp actually wrote), and `targetAcl` is what we read
    // back from the destination immediately after `Set-FileSecurityFast`.
    if (output.inValid.length > 0) {
      this.logger.log(
        `[${logContext?.workflowId ?? ''}] ACL post-stamp validation mismatch - ` +
        `sourcePath=${logContext?.sourcePath ?? ''} targetPath=${logContext?.targetPath ?? ''} ` +
        `inValid="${output.inValid.trim()}" ` +
        `sourceSd=${JSON.stringify(sourceAcl)} ` +
        `destinationSd=${JSON.stringify(targetAcl)}`,
      );
    }
    return output;
  }

  async resolveUsernamesToSids(
    usernames: string[],
  ): Promise<Map<string, string>> {
    const usernameToSidMap = new Map<string, string>();
    const command = `Resolve-UsernamesToSid -Username ${usernames.join(',')}`;
    const output = await this.winShellService.executeCommand(command);

    if (output.stderr) {
      this.logger.warn(`Resolve-UsernamesToSid stderr: ${output.stderr}`);
    }

    let sidMappings: any;
    try {
      sidMappings = JSON.parse(output.stdout);
    } catch (err) {
      throw new Error(`Failed to parse Resolve-UsernamesToSid output: ${output.stderr || err.message}; stdout=${output.stdout}`);
    }
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
  
  /*
     do reparse check via koffi, so that it is fast and use it for ignoring the dir.
     Incase we are getting invalid_file_attributes we assume as true and fallback to powershell.
  */
  isReparsePoint(filePath: string): boolean {
    if (!GetFileAttributesW) return true;
    const startedAt = process.hrtime.bigint();
    const attrs = GetFileAttributesW(filePath);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    this.logger.debug(`[reparse-check-timing] native reparse check for ${filePath} took ${elapsedMs.toFixed(4)}ms`);
    if (attrs === this.INVALID_FILE_ATTRIBUTES) return true;
    return (attrs & this.FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
  }

  async detectSymbolicLinkType(path: string): Promise<FileType> {
    const startedAt = Date.now();
    try {
      const script = `$srcFile = '${path.replace(/'/g, "''")}'\n${psGetLinkInfoScript}`;
      const output = await this.winShellService.executeCommand(script);
      if (output.stderr) throw new Error(output.stderr);
      const result = JSON.parse(output.stdout);

      this.logger.debug(`[link-detect-timing] PowerShell link detection for ${path} took ${Date.now() - startedAt}ms`);
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
