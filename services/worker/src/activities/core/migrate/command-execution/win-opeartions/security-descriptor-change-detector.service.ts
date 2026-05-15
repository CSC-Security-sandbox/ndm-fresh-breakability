import { Inject, Injectable } from '@nestjs/common';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { SecurityDescriptorChangeDetector } from 'src/activities/utils/utils';
import { WinOperationService } from './win-operation.service';
import { parseStampableAttributes } from './file-attributes';

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
function getComparableAces(aces: Ace[] | null | undefined): ComparableAce[] {
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

/**
 * Well-known SID for the CREATOR OWNER placeholder principal. The kernel
 * mutates the `AccessMask` (e.g., `GENERIC_ALL` → `FILE_ALL_ACCESS`) and
 * strips/sets inheritance flag bits on these ACEs as part of inheritance
 * evaluation. Those mutations are *idempotent on the destination* but not on
 * the written form, so a strict positional compare would oscillate the gate
 * into restamping forever. Treat CREATOR OWNER ACEs as count-matched on
 * `(AceType)` only — same policy `validateAclOperation` already applies for
 * the same reason.
 */
const CREATOR_OWNER_SID = 'S-1-3-0';

/**
 * Partition a comparable-ACE list into CREATOR OWNER ACEs and the
 * non-CREATOR-OWNER remainder while preserving the source order on the
 * remainder. The gate compares the non-CREATOR-OWNER remainder
 * positionally (Windows DACLs are order-sensitive) and the CREATOR OWNER
 * ACEs set-wise on `AceType` only.
 */
function partitionAcesByCreatorOwner(allAces: ComparableAce[]): {
  creatorOwnerAces: ComparableAce[];
  nonCreatorOwnerAces: ComparableAce[];
} {
  const creatorOwnerAces: ComparableAce[] = [];
  const nonCreatorOwnerAces: ComparableAce[] = [];
  for (const candidateAce of allAces) {
    if (candidateAce.Sid === CREATOR_OWNER_SID) {
      creatorOwnerAces.push(candidateAce);
    } else {
      nonCreatorOwnerAces.push(candidateAce);
    }
  }
  return { creatorOwnerAces, nonCreatorOwnerAces };
}

/**
 * Scan-time SMB security-descriptor change detector. Compares the
 * expected-destination security descriptor (source after SID mapping +
 * inheritance-mode transforms, mirroring what `stampAclOperation` would
 * write) against the live destination, and reports the first drifted
 * field so the caller (`isMetaUpdated`) can short-circuit into stamp.
 *
 * Owns the comparator semantics; delegates raw ACL I/O, SID mapping, and
 * inheritance-mode transforms to {@link WinOperationService} so the
 * stamp path and the gate stay byte-faithful with each other.
 */
@Injectable()
export class SecurityDescriptorChangeDetectorService
  implements SecurityDescriptorChangeDetector
{
  private readonly logger: LoggerService;

  constructor(
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly winOperationService: WinOperationService,
  ) {
    this.logger = loggerFactory.create(
      SecurityDescriptorChangeDetectorService.name,
    );
  }

  /**
   * Build the security descriptor we expect the destination to hold
   * post-stamp: source SD → SID-map (when configured) → Invalid-SID
   * revert (mirrors stamp's normalization) → SMB inheritance-mode
   * transform (DLM-root only). Without each of these stages the gate
   * would false-positive drift on every incremental scan even when the
   * destination already matches what stamp would (re-)write.
   */
  private async prepareExpectedDestinationSecurityDescriptor(
    sourceSecurityDescriptor: SecurityDescriptor,
    jobContext?: JobManagerContext,
    applyInheritanceMode = false,
  ): Promise<SecurityDescriptor> {
    let expectedSecurityDescriptor = sourceSecurityDescriptor;

    if (jobContext?.jobConfig?.options?.isIdentityMappingAvailable) {
      expectedSecurityDescriptor = await this.winOperationService.mapSIDToTarget(
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
      expectedSecurityDescriptor = this.winOperationService.applySmbInheritanceModeTransform(
        expectedSecurityDescriptor,
        this.winOperationService.resolveSmbInheritanceMode(jobContext),
      );
    }

    return expectedSecurityDescriptor;
  }

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
    if (!!expected.DaclPresent !== !!actual.DaclPresent) {
      return { equal: false, reason: { field: 'daclPresent', expectedValue: !!expected.DaclPresent, actualValue: !!actual.DaclPresent } };
    }
    if (!!expected.DaclProtected !== !!actual.DaclProtected) {
      return { equal: false, reason: { field: 'daclProtected', expectedValue: !!expected.DaclProtected, actualValue: !!actual.DaclProtected } };
    }

    // NULL DACL on both sides → ACE-by-ACE comparison is undefined by
    // Win32 contract (SE_DACL_PRESENT=0 means the object has no DACL at
    // all; the kernel skips DACL evaluation entirely for access checks).
    // The reader normalizes this to `DaclAces: null`, but historically
    // surfaced phantom inherited ACE bytes the kernel keeps lying around
    // even when SE_DACL_PRESENT is cleared, which made every incremental
    // scan re-stamp these files. Now that DaclPresent matches and is
    // false on both sides, the descriptors are by definition equal as
    // far as Windows access checks are concerned — short-circuit before
    // touching DaclAces.
    //
    // Attributes still need to be checked (they live outside the DACL),
    // so fall through to the attribute compare via the dedicated check
    // below by handling only the ACE walk skip here.
    if (!expected.DaclPresent && !actual.DaclPresent) {
      const expectedAttrsForNullDacl = parseStampableAttributes(expected.Attributes);
      const actualAttrsForNullDacl = parseStampableAttributes(actual.Attributes);
      if (expectedAttrsForNullDacl !== actualAttrsForNullDacl) {
        return {
          equal: false,
          reason: {
            field: 'attributes',
            expectedValue: expectedAttrsForNullDacl,
            actualValue: actualAttrsForNullDacl,
          },
        };
      }
      return { equal: true };
    }
    // `DaclAutoInherit` (SE_DACL_AUTO_INHERITED) is intentionally NOT
    // compared here. Windows' inheritance engine sets and clears this bit
    // on its own as a side-effect of inheritance propagation — the value
    // we wrote is not guaranteed to be the value we read back even on a
    // byte-faithful stamp, so strict equality would oscillate the gate
    // into restamping the same descriptor on every incremental scan. The
    // bit is still round-tripped by the reader/writer (so kernel-driven
    // semantics are preserved); only the comparator declines to gate on
    // it. Symmetric with `validateAclOperation`.
    const expectedAttrs = parseStampableAttributes(expected.Attributes);
    const actualAttrs = parseStampableAttributes(actual.Attributes);
    if (expectedAttrs !== actualAttrs) {
      return { equal: false, reason: { field: 'attributes', expectedValue: expectedAttrs, actualValue: actualAttrs } };
    }
    const expectedAces = getComparableAces(expected.DaclAces);
    const actualAces = getComparableAces(actual.DaclAces);

    // Split CREATOR OWNER ACEs out of both sides. They are compared
    // count-by-AceType (lenient) below; the remaining ACEs go through the
    // existing strict positional compare. See the function-header comment
    // for why CREATOR OWNER cannot be compared strictly without inducing
    // a restamp loop.
    const expectedAcesPartitioned = partitionAcesByCreatorOwner(expectedAces);
    const actualAcesPartitioned = partitionAcesByCreatorOwner(actualAces);

    // CREATOR OWNER count-by-AceType match. Build per-AceType count maps,
    // then iterate the union of keys so a missing-on-one-side AceType is
    // reported, not silently dropped. `expectedCount > actualCount` →
    // still missing on destination; `actualCount > expectedCount` → still
    // extra on destination. Strict mask/flags drift on a paired CREATOR
    // OWNER ACE is tolerated by design.
    const countCreatorOwnerAcesByAceType = (
      creatorOwnerAces: ComparableAce[],
    ): Map<number, number> => {
      const countsByAceType = new Map<number, number>();
      for (const creatorOwnerAce of creatorOwnerAces) {
        countsByAceType.set(
          creatorOwnerAce.AceType,
          (countsByAceType.get(creatorOwnerAce.AceType) ?? 0) + 1,
        );
      }
      return countsByAceType;
    };
    const expectedCreatorOwnerCountsByAceType = countCreatorOwnerAcesByAceType(
      expectedAcesPartitioned.creatorOwnerAces,
    );
    const actualCreatorOwnerCountsByAceType = countCreatorOwnerAcesByAceType(
      actualAcesPartitioned.creatorOwnerAces,
    );
    const creatorOwnerAceTypesSeenOnEitherSide = new Set<number>([
      ...expectedCreatorOwnerCountsByAceType.keys(),
      ...actualCreatorOwnerCountsByAceType.keys(),
    ]);
    for (const aceType of creatorOwnerAceTypesSeenOnEitherSide) {
      const expectedCount = expectedCreatorOwnerCountsByAceType.get(aceType) ?? 0;
      const actualCount = actualCreatorOwnerCountsByAceType.get(aceType) ?? 0;
      if (expectedCount > actualCount) {
        const missingCreatorOwnerAce =
          expectedAcesPartitioned.creatorOwnerAces.find((expectedAce) => expectedAce.AceType === aceType) ??
          expectedAcesPartitioned.creatorOwnerAces[0];
        return {
          equal: false,
          reason: {
            field: 'aceMissingOnDestination',
            expectedValue: missingCreatorOwnerAce,
            actualValue: null,
          },
        };
      }
      if (actualCount > expectedCount) {
        const extraCreatorOwnerAce =
          actualAcesPartitioned.creatorOwnerAces.find((actualAce) => actualAce.AceType === aceType) ??
          actualAcesPartitioned.creatorOwnerAces[0];
        return {
          equal: false,
          reason: {
            field: 'aceExtraOnDestination',
            expectedValue: null,
            actualValue: extraCreatorOwnerAce,
          },
        };
      }
    }

    // Strict positional compare on the non-CREATOR-OWNER remainder.
    const expectedNonCreatorOwnerAces = expectedAcesPartitioned.nonCreatorOwnerAces;
    const actualNonCreatorOwnerAces = actualAcesPartitioned.nonCreatorOwnerAces;
    if (expectedNonCreatorOwnerAces.length !== actualNonCreatorOwnerAces.length) {
      const actualAceKeys = new Set(actualNonCreatorOwnerAces.map(aceKey));
      const expectedAceKeys = new Set(expectedNonCreatorOwnerAces.map(aceKey));
      if (expectedNonCreatorOwnerAces.length > actualNonCreatorOwnerAces.length) {
        const missingAceOnDestination =
          expectedNonCreatorOwnerAces.find((expectedAce) => !actualAceKeys.has(aceKey(expectedAce))) ??
          expectedNonCreatorOwnerAces[0];
        return {
          equal: false,
          reason: {
            field: 'aceMissingOnDestination',
            expectedValue: missingAceOnDestination,
            actualValue: null,
          },
        };
      }
      const extraAceOnDestination =
        actualNonCreatorOwnerAces.find((actualAce) => !expectedAceKeys.has(aceKey(actualAce))) ??
        actualNonCreatorOwnerAces[0];
      return {
        equal: false,
        reason: {
          field: 'aceExtraOnDestination',
          expectedValue: null,
          actualValue: extraAceOnDestination,
        },
      };
    }
    for (let aceIndex = 0; aceIndex < expectedNonCreatorOwnerAces.length; aceIndex++) {
      const expectedAce = expectedNonCreatorOwnerAces[aceIndex];
      const actualAce = actualNonCreatorOwnerAces[aceIndex];
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
   * Reads source and destination security descriptors in parallel via
   * `WinOperationService.getAclOperation`, builds the expected destination
   * descriptor via `prepareExpectedDestinationSecurityDescriptor` (which
   * applies SID mapping, mirrors stamp's Invalid-SID normalization when
   * mapping is configured, and applies the SMB inheritance-mode transform
   * when the caller flags this as the DLM root via
   * `applyInheritanceMode`), then runs `securityDescriptorEquals`. On
   * mismatch, emits one structured INFO log line per item with the
   * offending field.
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
      this.winOperationService.getAclOperation(sourcePath, true, workflowId),
      this.winOperationService.getAclOperation(targetPath, false, workflowId),
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
      // `expectedDestinationSecurityDescriptor` is the *post-mapping,
      // post-Invalid-revert, post-inheritance-transform* descriptor — i.e.,
      // exactly what `stampAclOperation` would hand to `Set-FileSecurityFast`
      // on the destination if this mismatch triggers a re-stamp. It is the
      // same byte form the kernel will see, so an operator can reproduce
      // stamp behaviour from logs alone.
      this.logger.log(
        `[${workflowId}] ACL mismatch on destination - target=${targetPath} source=${sourcePath} ` +
        `field=${result.reason.field} ` +
        `expectedValue=${JSON.stringify(result.reason.expectedValue)} ` +
        `actualValue=${JSON.stringify(result.reason.actualValue)} ` +
        `expectedDestinationSecurityDescriptor=${JSON.stringify(expectedDestinationSecurityDescriptor)} ` +
        `destinationSecurityDescriptor=${JSON.stringify(destinationSecurityDescriptor)}`,
      );
    }
    return !result.equal;
  }
}
