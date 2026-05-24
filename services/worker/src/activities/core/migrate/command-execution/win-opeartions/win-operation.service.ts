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
import { SecurityDescriptorChangeDetector, dmError } from 'src/activities/utils/utils';

export enum SmbPermissionInheritanceMode {
  INHERIT_PERMS_AS_IS       = 'INHERIT_PERMS_AS_IS',
  INHERIT_PERMS_AS_EXPLICIT = 'INHERIT_PERMS_AS_EXPLICIT',
}

// Windows API initialization for ADS detection
let FindFirstStreamW: any;
let FindNextStreamW: any;
let FindClose: any;
let WIN32_FIND_STREAM_DATA: any;

/**
 * Numeric values from `System.IO.FileAttributes`. Only the attributes
 * `[System.IO.File]::SetAttributes` can actually write end up in the
 * comparison mask; attributes that require separate Win32 syscalls
 * (`FSCTL_SET_COMPRESSION`, `EncryptFile`, `FSCTL_SET_SPARSE`, etc.) are
 * deliberately excluded so a missing-on-destination value cannot trigger
 * an infinite stamp loop. See plan: "Comparison principle" → "Fields we
 * cannot compare".
 */
const FILE_ATTRIBUTE_FLAGS: Readonly<Record<string, number>> = Object.freeze({
  ReadOnly: 0x0001,
  Hidden: 0x0002,
  System: 0x0004,
  Directory: 0x0010,
  Archive: 0x0020,
  Device: 0x0040,
  Normal: 0x0080,
  Temporary: 0x0100,
  SparseFile: 0x0200,
  ReparsePoint: 0x0400,
  Compressed: 0x0800,
  Offline: 0x1000,
  NotContentIndexed: 0x2000,
  Encrypted: 0x4000,
  IntegrityStream: 0x8000,
  NoScrubData: 0x20000,
});

const STAMPABLE_ATTR_MASK =
  FILE_ATTRIBUTE_FLAGS.ReadOnly |
  FILE_ATTRIBUTE_FLAGS.Hidden |
  FILE_ATTRIBUTE_FLAGS.System |
  FILE_ATTRIBUTE_FLAGS.Archive |
  FILE_ATTRIBUTE_FLAGS.Normal |
  FILE_ATTRIBUTE_FLAGS.Temporary |
  FILE_ATTRIBUTE_FLAGS.Offline |
  FILE_ATTRIBUTE_FLAGS.NotContentIndexed;

function parseStampableAttributes(attrs: string | undefined): number {
  if (!attrs) return 0;
  let mask = 0;
  for (const raw of attrs.split(',')) {
    const tok = raw.trim();
    const bit = FILE_ATTRIBUTE_FLAGS[tok];
    if (bit !== undefined) mask |= bit;
  }
  return mask & STAMPABLE_ATTR_MASK;
}

type ComparableAce = Pick<Ace, 'Sid' | 'AccessMask' | 'AceType' | 'AceFlags'>;

/**
 * Project a `DaclAces` array down to the fields the comparator looks at and
 * drop ACE types we don't stamp (audit / object ACEs — `AceType` other than
 * 0 = AccessAllowed and 1 = AccessDenied).
 *
 * Order is preserved as read from the security descriptor. Windows DACLs
 * are order-sensitive (first-match decides access, and the canonical-order
 * convention assigns semantic positions to Explicit Deny / Explicit Allow /
 * Inherited Deny / Inherited Allow), so a faithful "source vs destination"
 * comparator must compare positionally — any order drift on destination is
 * a real semantic drift and must trigger a re-stamp.
 */
function getComparableAces(aces: Ace[] | undefined): ComparableAce[] {
  if (!aces || aces.length === 0) return [];
  const result: ComparableAce[] = [];
  for (const a of aces) {
    if (a.AceType !== 0 && a.AceType !== 1) continue;
    result.push({
      Sid: a.Sid,
      AccessMask: a.AccessMask,
      AceType: a.AceType,
      AceFlags: a.AceFlags,
    });
  }
  return result;
}

function aceKey(a: ComparableAce): string {
  return `${a.Sid}|${a.AceType}|${a.AccessMask}|${a.AceFlags}`;
}



@Injectable()
export class WinOperationService implements SecurityDescriptorChangeDetector {
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

    // 2c. Apply SMB inheritance mode for the DLM root (no-op for all other commands).
    const filteredAcl = this.applySmbInheritanceMode(acl, command, jobContext);

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
      () => this.validateAclOperation(filteredAcl, targetAcl),
    );
    if (validation.inValid.length > 0){
      command.ops[OPS_CMD.STAMP_META].params.error = validation.inValid;
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
  private resolveSmbInheritanceMode(jobContext?: JobManagerContext): SmbPermissionInheritanceMode {
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

  /**
   * Build the security descriptor we *expect* to see on the destination,
   * given the raw source security descriptor and the job's SID-mapping
   * configuration. This is what `securityDescriptorEquals` compares against
   * the destination's actual security descriptor.
   *
   * SID mapping not configured (`isIdentityMappingAvailable: false`):
   * return the source descriptor untouched. Raw SIDs that genuinely differ
   * across domains will surface as drift and fall through to the existing
   * stamp path (documented "warn-and-stamp" fallback for cross-domain jobs
   * without a SID map).
   *
   * SID mapping configured: translate Owner / Group / per-ACE SIDs via the
   * SID map, then mirror the post-stamp normalization that
   * `stampAclOperation` does for unmappable principals so the comparison
   * matches what would actually land on the destination:
   *
   *   - `Owner` / `Group` that map to the `'Invalid'` sentinel are reverted
   *     to the original source SID (same as stamp). The gate compares
   *     against the reverted value, not against `'Invalid'`, so a file
   *     that's already been stamped under this regime is recognized as
   *     in-sync on subsequent incrementals instead of re-stamping every
   *     scan.
   *   - ACEs whose SID maps to `'Invalid'` are dropped from the expected
   *     DACL (same filter as stamp).
   *
   * Per-principal error reporting for unmappable SIDs remains owned by
   * `stampAclOperation` + `validateAclOperation` — it fires on the first
   * scan that actually triggers a stamp, then quiets down on subsequent
   * idempotent scans (which is what we want).
   *
   * Note: `mapSIDToTarget` mutates its input. The gate owns the source
   * descriptor read in `hasSecurityDescriptorChanged`, so the mutation is
   * contained. Do **not** pass a shared/cached source descriptor into this
   * helper.
   */
  private async prepareExpectedDestinationSecurityDescriptor(
    sourceSecurityDescriptor: SecurityDescriptor,
    jobContext?: JobManagerContext,
    applyInheritanceMode = false,
  ): Promise<SecurityDescriptor> {
    let expectedSecurityDescriptor = sourceSecurityDescriptor;

    if (jobContext?.jobConfig?.options?.isIdentityMappingAvailable) {
      expectedSecurityDescriptor = await this.mapSIDToTarget(
        sourceSecurityDescriptor,
        jobContext.jobRunId,
      );

      // Mirror stampAclOperation's post-mapping normalization so the expected
      // descriptor equals what stamp would actually write. Without this the
      // gate would force a re-stamp on every incremental for files containing
      // unmappable SIDs, even when the destination already matches the
      // post-stamp state from a previous run.
      if (expectedSecurityDescriptor.Owner === 'Invalid' && expectedSecurityDescriptor.originalOwner) {
        expectedSecurityDescriptor.Owner = expectedSecurityDescriptor.originalOwner;
      }
      if (expectedSecurityDescriptor.Group === 'Invalid' && expectedSecurityDescriptor.originalGroup) {
        expectedSecurityDescriptor.Group = expectedSecurityDescriptor.originalGroup;
      }
      if (expectedSecurityDescriptor.DaclAces) {
        expectedSecurityDescriptor.DaclAces = expectedSecurityDescriptor.DaclAces.filter(
          (ace) => ace.Sid !== 'Invalid',
        );
      }
    }

    // Mirror stampAclOperation's DLM-root inheritance-mode transform.
    // Without this, the destination's transformed ACEs (e.g., inherited
    // flipped to explicit) would never equal the un-transformed source,
    // forcing a re-stamp on every incremental scan of the DLM root.
    if (applyInheritanceMode) {
      expectedSecurityDescriptor = this.applySmbInheritanceModeTransform(
        expectedSecurityDescriptor,
        this.resolveSmbInheritanceMode(jobContext),
      );
    }

    return expectedSecurityDescriptor;
  }

  async resetFileAttributes(path: string): Promise<boolean> {
    try {
      await this.winShellService.executeCommand(`attrib -H -R "${path}"`);
      return true;
    } catch {
      throw new Error(`Failed to reset file attributes for ${path}`);
    }
  }

  /**
   * Strict equality check between an `expected` security descriptor and the
   * `actual` one read from disk. In production the gate path supplies the
   * expected-destination descriptor (post-SID-mapping, post-Invalid-
   * normalization) as `expected` and the live destination descriptor as
   * `actual`. The comparator itself is direction-agnostic — it compares
   * value-for-value, so callers can also pass raw source vs destination if
   * they don't need SID mapping.
   *
   * Compares only the fields the production stamp pipeline can actually
   * write to destination: `Owner`, `Group`, `DaclProtected`, `DaclAutoInherit`,
   * the settable subset of `Attributes`, and ACEs of type 0/1 with their
   * `AceFlags` byte intact.
   *
   * **ACE order is significant** — Windows DACLs are order-sensitive
   * (first-match decides access, and canonical-order positions carry
   * semantic meaning), so this comparator performs a positional element-
   * wise compare. Any order drift on destination is reported as drift, not
   * silently accepted. When the destination has the same ACE set in a
   * different order, the per-position diff is surfaced as `aceFieldDiff`.
   *
   * Short-circuits on the first mismatch and returns the offending field
   * inside `reason` so the caller can log a structured single line without
   * a second pass over the data.
   */
  securityDescriptorEquals(
    expected: SecurityDescriptor,
    actual: SecurityDescriptor,
  ): SecurityDescriptorCompareResult {
    if (expected.Owner !== actual.Owner) {
      return { equal: false, reason: { field: 'owner', expectedValue: expected.Owner, actualValue: actual.Owner } };
    }
    if (expected.Group !== actual.Group) {
      return { equal: false, reason: { field: 'group', expectedValue: expected.Group, actualValue: actual.Group } };
    }
    if (!!expected.DaclProtected !== !!actual.DaclProtected) {
      return { equal: false, reason: { field: 'daclProtected', expectedValue: !!expected.DaclProtected, actualValue: !!actual.DaclProtected } };
    }
    // Watch-list: Windows' inheritance engine can set/clear this bit on its
    // own. Compared strictly by default; mask this branch off if real testing
    // surfaces a stable round-trip mismatch.
    if (!!expected.DaclAutoInherit !== !!actual.DaclAutoInherit) {
      return { equal: false, reason: { field: 'daclAutoInherit', expectedValue: !!expected.DaclAutoInherit, actualValue: !!actual.DaclAutoInherit } };
    }
    const expectedAttrs = parseStampableAttributes(expected.Attributes);
    const actualAttrs = parseStampableAttributes(actual.Attributes);
    if (expectedAttrs !== actualAttrs) {
      return { equal: false, reason: { field: 'attributes', expectedValue: expectedAttrs, actualValue: actualAttrs } };
    }
    const expectedAces = getComparableAces(expected.DaclAces);
    const actualAces = getComparableAces(actual.DaclAces);
    if (expectedAces.length !== actualAces.length) {
      const actualKeys = new Set(actualAces.map(aceKey));
      const expectedKeys = new Set(expectedAces.map(aceKey));
      if (expectedAces.length > actualAces.length) {
        const missing = expectedAces.find(a => !actualKeys.has(aceKey(a))) ?? expectedAces[0];
        return { equal: false, reason: { field: 'aceMissingOnDestination', expectedValue: missing, actualValue: null } };
      }
      const extra = actualAces.find(a => !expectedKeys.has(aceKey(a))) ?? actualAces[0];
      return { equal: false, reason: { field: 'aceExtraOnDestination', expectedValue: null, actualValue: extra } };
    }
    for (let i = 0; i < expectedAces.length; i++) {
      const expectedAce = expectedAces[i];
      const actualAce = actualAces[i];
      if (
        expectedAce.Sid !== actualAce.Sid ||
        expectedAce.AccessMask !== actualAce.AccessMask ||
        expectedAce.AceType !== actualAce.AceType ||
        expectedAce.AceFlags !== actualAce.AceFlags
      ) {
        return { equal: false, reason: { field: 'aceFieldDiff', expectedValue: expectedAce, actualValue: actualAce } };
      }
    }
    return { equal: true };
  }

  /**
   * Scan-time entry point for SMB metadata-change detection.
   *
   * Reads source and destination security descriptors in parallel, builds
   * the expected destination descriptor via
   * `prepareExpectedDestinationSecurityDescriptor` (which applies SID
   * mapping, mirrors stamp's Invalid-SID normalization when mapping is
   * configured, and applies the SMB inheritance-mode transform when the
   * caller flags this as the DLM root via `applyInheritanceMode`), then
   * runs `securityDescriptorEquals`. On mismatch, emits one structured
   * INFO log line per item with the offending field.
   *
   * `applyInheritanceMode` mirrors stamp's per-command
   * `OPS_CMD.STAMP_META.params.applyInheritanceMode` flag, which is set
   * only on the DLM root by `MigrateScanService.initDlmRootStamp`. Caller
   * (`command-generation.service.buildCommand` → `isMetaUpdated`) computes
   * the same predicate (`isDirectoryLevelMigration(jobConfig) && fPath ===
   * '/'`) and passes it through. Without this, the DLM root would
   * false-positive drift on every incremental scan because the destination
   * holds the transformed ACEs while the gate compares against the
   * un-transformed source.
   *
   * Decision matrix:
   * - SID mapping configured → compare against the post-mapping,
   *   post-Invalid-normalization expected descriptor. Files where mapping
   *   returned `'Invalid'` but the destination already holds the reverted-
   *   to-source SID (or has the Invalid ACEs dropped) are correctly
   *   recognized as in-sync and skip the stamp.
   * - SID mapping not configured → compare raw SIDs. Cross-domain SIDs
   *   that genuinely differ will surface as drift and fall through to the
   *   existing stamp path.
   *
   * First-time-stamp case (destination object does not yet exist) is
   * handled by callers — `isMetaUpdated` short-circuits before this method
   * is invoked when `dFile` is undefined, so this method is only reached
   * when destination metadata already exists. That means a log here always
   * reflects a genuine drift between source and destination, not an
   * initial-stamp event.
   */
  async hasSecurityDescriptorChanged(
    sourcePath: string,
    targetPath: string,
    jobContext?: JobManagerContext,
    applyInheritanceMode = false,
  ): Promise<boolean> {
    const workflowId = jobContext?.jobRunId ?? '';
    const [sourceSecurityDescriptor, destinationSecurityDescriptor] = await Promise.all([
      this.getAclOperation(sourcePath, true, workflowId),
      this.getAclOperation(targetPath, false, workflowId),
    ]);

    const expectedDestinationSecurityDescriptor =
      await this.prepareExpectedDestinationSecurityDescriptor(
        sourceSecurityDescriptor,
        jobContext,
        applyInheritanceMode,
      );
    const result = this.securityDescriptorEquals(
      expectedDestinationSecurityDescriptor,
      destinationSecurityDescriptor,
    );
    if (!result.equal && result.reason) {
      // NOTE: This log string is operator-facing. The prefix
      // "ACL mismatch on destination - target=" is intentionally retained
      // (instead of the strictly-correct "Security descriptor mismatch")
      // for backward compatibility with operator grep / log-aggregation
      // pipelines that key on this exact substring. "ACL" here is used in
      // the colloquial Windows-ops sense for the full security descriptor.
      //
      // `expectedSd` is the post-mapping, post-Invalid-revert, post-
      // inheritance-transform descriptor (i.e., what stamp would write).
      // `actualSd` is the live destination descriptor. Both are logged in
      // full alongside the headline `expectedValue`/`actualValue` so the
      // operator can see every drifted field in one line — the headline
      // pair surfaces only the first mismatch (short-circuit), the full
      // SDs let them diff the rest without re-fetching from disk.
      this.logger.log(
        `[${workflowId}] ACL mismatch on destination - target=${targetPath} source=${sourcePath} ` +
        `field=${result.reason.field} ` +
        `expectedValue=${JSON.stringify(result.reason.expectedValue)} ` +
        `actualValue=${JSON.stringify(result.reason.actualValue)} ` +
        `expectedSd=${JSON.stringify(expectedDestinationSecurityDescriptor)} ` +
        `actualSd=${JSON.stringify(destinationSecurityDescriptor)}`,
      );
    }
    return !result.equal;
  }

  async validateAclOperation(
    sourceAcl: SecurityDescriptor,
    targetAcl: SecurityDescriptor,
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
