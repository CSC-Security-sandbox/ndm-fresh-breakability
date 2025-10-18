type SecurityDescriptor = {
  Owner: string;
  Group: string;
  DaclAces: Ace[];
  AdsStreams?: AdsStream[];
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

type AdsStream = {
  StreamName: string;
  Size: number;
  Content: string;
};

interface ValidatorOutput {
  sourceSID: string;
  targetSID: string;
  inValid: string;
}


