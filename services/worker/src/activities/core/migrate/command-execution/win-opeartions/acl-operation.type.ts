type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
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
  | 'daclProtected'
  | 'daclAutoInherit'
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


