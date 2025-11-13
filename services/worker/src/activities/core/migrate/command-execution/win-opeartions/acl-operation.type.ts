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

// Share-level permission types
type ShareSecurityDescriptor = {
  shareName: string;
  serverName: string;
  permissions: SharePermission[];
  maxUsers: number;
  currentUsers: number;
  path: string;
  remark: string;
};

type SharePermission = {
  accountName: string;
  sid: string;
  accessMask: number;
  accessType: 'Allow' | 'Deny';
};

type SharePermissions = {
  permissions: SharePermission[];
  maxUsers?: number;
  remark?: string;
};


