type SecurityDescriptor = {
  Owner: string;
  Group: string;
  /**
   * Three-state representation of the discretionary ACL, mirroring Win32:
   *   - `null`  → NULL DACL (`SE_DACL_PRESENT = 0`). There is no DACL on
   *               the object; Windows allows full access to all callers.
   *               `DaclAces` is intentionally NOT an empty array here —
   *               that would conflate this state with the empty-DACL case.
   *   - `[]`    → DACL is present but contains zero ACEs
   *               (`SE_DACL_PRESENT = 1`, AceCount = 0). Windows denies all
   *               access.
   *   - `[…]`   → DACL is present with one or more ACEs.
   *
   * `DaclPresent` and `DaclAces` are kept in lockstep:
   * `DaclPresent === false` always implies `DaclAces === null`, and vice
   * versa. The reader (`Get-FileSecurityFast`) and stamper
   * (`Set-FileSecurityFast`) both enforce this invariant; the comparator
   * and validator both honor it (NULL on either side short-circuits the
   * per-ACE walk).
   */
  DaclAces: Ace[] | null;
  Attributes: string;
  DaclPresent: boolean;
  DaclProtected: boolean;
  DaclAutoInherit: boolean;
  originalOwner: string;
  originalGroup: string;
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
  originalSid: string;
};

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}

/**
 * Field key for the first mismatch surfaced by `securityDescriptorEquals`.
 * Use these as stable log/grep keys; do not switch on free-form strings.
 */
type SecurityDescriptorMismatchField =
  | 'owner'
  | 'group'
  | 'daclPresent'
  | 'daclProtected'
  | 'attributes'
  | 'aceMissingOnDestination'
  | 'aceExtraOnDestination'
  | 'aceFieldDiff';

interface SecurityDescriptorMismatchReason {
  field: SecurityDescriptorMismatchField;
  expectedValue: unknown;
  actualValue: unknown;
}

interface SecurityDescriptorCompareResult {
  equal: boolean;
  reason?: SecurityDescriptorMismatchReason;
}

interface ADSInfo {
  hasADS: boolean;
  streamCount: number;
  streamNames: string[];
  streamSizes: number[];
  totalSize: number;
}


