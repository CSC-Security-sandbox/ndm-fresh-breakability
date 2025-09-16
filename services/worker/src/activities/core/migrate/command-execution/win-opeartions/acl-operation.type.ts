type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
};

type Ace = {
  Sid: string;
  AccessMask: number;
  AceType: number;
  AceFlags: number;
  IsInherited: boolean;
};