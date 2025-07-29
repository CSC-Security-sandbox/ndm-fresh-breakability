

export interface AclEntry {
  IdentityReference: string;
  AccessControlType: 'Allow' | 'Deny';
  FileSystemRights: string;
  InheritanceFlags: string;
  PropagationFlags: string;
}

export interface AclObject {
  Path: string;
  Owner: string;
  Group: string;
  Access: {
    value: AclEntry[];
  };
}

export interface ValidateMappingResult {
    failedSid: string,
    sourceAcl: string,
    targetAcl: string
}

export interface ValidateMappingInput {
    sidMapping: Map<string, string>;
    expected: AclObject;
    actual: AclObject;
    failedMaps: string[];
}