type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  Attributes: string;
  DaclPresent: boolean;
  DaclProtected: boolean;
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
};

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}


