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
 * Interface for NTFS Alternate Data Stream (ADS) information
 * Returned by detectADSInfo() method
 */
interface ADSInfo {
  hasADS: boolean;         // Whether the file has any ADS
  streamCount: number;     // Number of ADS streams
  streamNames: string[];   // Array of stream names
  streamSizes: number[];   // Array of stream sizes (same order as names)
  totalSize: number;       // Total size of all streams combined
}

