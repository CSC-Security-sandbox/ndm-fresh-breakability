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
 * Field key for the first ACL mismatch surfaced by `aclEquals`. Use these
 * as stable log/grep keys; do not switch on free-form strings.
 */
type AclMismatchField =
  | 'owner'
  | 'group'
  | 'daclProtected'
  | 'daclAutoInherit'
  | 'attributes'
  | 'aceAdded'
  | 'aceRemoved'
  | 'aceFieldDiff';

interface AclMismatchReason {
  field: AclMismatchField;
  srcValue: unknown;
  dstValue: unknown;
}

interface AclCompareResult {
  equal: boolean;
  reason?: AclMismatchReason;
}

interface ADSInfo {
  hasADS: boolean;
  streamCount: number;
  streamNames: string[];
  streamSizes: number[];
  totalSize: number;
}


