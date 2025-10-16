type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  SaclAces?: Ace[];
  Attributes: string;
  DaclPresent: boolean;
  SaclPresent?: boolean;
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


