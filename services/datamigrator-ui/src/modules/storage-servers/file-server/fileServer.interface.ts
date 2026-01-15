import {
  BlueXpFormType,
  GetAllWorkersApiType,
  ValidateConnectionApiType,
} from "@/types/app.type";
import { ReactNode } from "react";

// Dell Isilon Zone Credentials Type
export interface ZoneCredentialsType {
  smbIp?: string;
  smbUsername?: string;
  smbPassword?: string;
  nfsIp?: string;
  nfsUsername?: string;
  nfsPassword?: string;
  numericZoneId?: number; // Numeric zone ID from Isilon API (e.g., 1 for "System")
  smartConnectSsip?: string; // SSIP from Isilon API for DNS resolution
  smartConnectDnsZone?: string; // DNS zone from Isilon API for resolver config
}

// Dell Isilon Zone Worker Assignments Type
export interface ZoneWorkerAssignmentsType {
  nfs: string[];
  smb: string[];
}

// THIS IS ONLY STATE LEVEL VARIABLES INCLUDE THIS WILL BE PARENT OF ALL
export interface FileServerStateContextType {
  fileServerId: string;
  isEditMode: boolean;
  setIsEditMode: (arg: boolean) => void;
  allWorkersList: GetAllWorkersApiType[];
  nfsValidatedWorkersIds: string[];
  smbValidatedWorkers: string[];
  setNfsValidatedWorkersIds: (arg: any) => void;
  setSmbValidatedWorkers: (arg: any) => void;
  setAllWorkersList: (arg: GetAllWorkersApiType[]) => void;
  workerIdWithName: WorkerIdWithNameType;
  setWorkerIdWithName: (arg: WorkerIdWithNameType) => void;
  selectedWorkerIds: string[];
  setSelectedWorkerIds: (arg: any) => void;
  validateConnectionLoader: any;
  setValidateConnectionLoader: (arg: any) => void;
  activeWorkerIds: string[];
  setActiveWorkerIds: (arg: string[]) => void;
  validateConnectionResults: ValidateConnectionApiType;
  setValidateConnectionResults: (arg: ValidateConnectionApiType) => void;
  disableNextButton: boolean;
  setDisableNextButton: (arg: boolean) => void;
  inactiveWorkerIds: string[];
  setInactiveWorkerIds: (arg: string[]) => void;
  errorMessageList: ErroredWorkersDetailsType[];
  setErrorMessageList: (arg: ErroredWorkersDetailsType) => void;
  handleValidateConnection: () => Promise<{
    errorMessageList: ErroredWorkersDetailsType[];
  }>;
  children?: ReactNode;
  nfsFailedWorkersIds: string[];
  setNfsFailedWorkersIds: (arg: string[]) => void;
  smbFailedWorkersIds: string[];
  setSmbFailedWorkersIds: (arg: string[]) => void;
  setSmbValidatedWorkersIds: (arg: string[]) => void;
  smbValidatedWorkersIds: string[];
  mountPaths: any[];
  setMountPaths: (arg: any[]) => void;
  isJobRunning: boolean;
  setIsJobRunning: (arg: boolean) => void;
  editingFileServerDetails: ConfigPayloadType;
  selectedProtocol: "NFS" | "SMB";
  setSelectedProtocol: (protocol: "NFS" | "SMB") => void;
  // Dell Isilon Access Zones
  selectedZoneIds: string[];
  setSelectedZoneIds: (arg: string[] | ((prev: string[]) => string[])) => void;
  zoneCredentials: Record<string, ZoneCredentialsType>;
  setZoneCredentials: (arg: Record<string, ZoneCredentialsType> | ((prev: Record<string, ZoneCredentialsType>) => Record<string, ZoneCredentialsType>)) => void;
  zoneWorkerAssignments: Record<string, ZoneWorkerAssignmentsType>;
  setZoneWorkerAssignments: (arg: Record<string, ZoneWorkerAssignmentsType> | ((prev: Record<string, ZoneWorkerAssignmentsType>) => Record<string, ZoneWorkerAssignmentsType>)) => void;
  // Active zone for worker assignment (Dell Isilon)
  activeZoneId: string | null;
  setActiveZoneId: (arg: string | null) => void;
  // Zones fetch error (Dell Isilon - prevents navigation in edit mode)
  zonesError: string | null;
  setZonesError: (arg: string | null) => void;
}

// Management Console Form Type for Dell Isilon
export interface ManagementConsoleFormType {
  managementHost: string;
  managementUsername: string;
  managementPassword: string;
}

// THIS IS CHILD, ONLY FORM WILL BE STORED IN THIS CONTEXT
export interface FileServerFormContextType {
  handleCreateConfiguration: () => void;
  handleEditConfiguration: () => void;
  serverTypeForm: any;
  nfsCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>;
  smbCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>;
  jobConfigForm: BlueXpFormType<jobConfigFormFormType>;
  hostCredentialsForm: BlueXpFormType<{ hostname: string }>;
  managementConsoleForm: BlueXpFormType<ManagementConsoleFormType>;
  workersListTableStateProps: any;
  nfsWorkersList: string[];
  children?: ReactNode;
  isFetching: boolean;
  refetch: () => void;
  // Dell Isilon Certificate State & Handlers
  certificateData: CertificateResponseType | null;
  setCertificateData: (data: CertificateResponseType | null) => void;
  showCertificateView: boolean;
  setShowCertificateView: (show: boolean) => void;
  certificateAccepted: boolean;
  setCertificateAccepted: (accepted: boolean) => void;
  fetchingCertificate: boolean;
  certificateError: string | null;
  handleFetchCertificate: () => Promise<void>;
  handleAcceptCertificate: () => Promise<boolean>;
  handleDeclineCertificate: () => void;
  resetCertificateState: () => void;
  isDellIsilonFormValid: () => boolean;
}

export interface CommonFileServerContextProviderType
  extends FileServerStateContextType,
    FileServerFormContextType {
  children: ReactNode;
}

export type ErroredWorkersDetailsType = {
  workerId: string;
  workerName: string;
  errorMessage: string;
};

export type WorkerIdWithNameType = {
  [key: string]: string;
};

export interface CredentialsValidationSchemaType {
  id?: string;
  userName: string;
  password: string;
  protocol: string;
  protocolVersion: {
    label: string;
    value: string;
  };
  exportPathSource: string;
}

// FOR JOB CONFIG STEP (4th)
export interface MountPathsOptionsListType {
  label: string;
  value: string;
}

export interface FileServerType {
  id?: string;
  serverType: string;
  protocol: string;
  fileServerName?: string; // Required by backend for Dell Isilon
  userName: string;
  host: string;
  password: string;
  workers: string[];
  protocolVersion?: string;
  exportPathSource?: string;
  createdBy?: string;
}

export interface ConfigPayloadType {
  id?: string;
  projectId: string;
  configName: string;
  configType: string;
  serverType?: string; // Required by backend: "OtherNAS" | "Dell" | "emc"
  fileServers: FileServerType[];
  createdBy?: string;
  workingDirectory: WorkingDirectoryDetailsType;
  // Dell Isilon Management Server (required for Dell Isilon file servers)
  managementServer?: ManagementServerType;
  // Dell Isilon management fields at root level (backend expects these)
  managementHost?: string;
  managementPort?: number;
  managementUsername?: string;
  managementPassword?: string;
  tlsAccepted?: boolean | null; // null for Other NAS, true/false for Dell Isilon
  tlsCertificate?: string;
  tlsExpiry?: string;
}

export interface ServerTypeFormType {
  configName: string;
  serverType: {
    label: string;
    value: string;
  };
}

export interface HostFormType {
  host: string;
}

export interface PopoverWrapperType {
  status: string;
  message: any;
}

export interface WorkingDirectoryDetailsType {
  pathId: string | null;
  pathName: string;
  workingDirectory: string;
}

export interface jobConfigFormFormType {
  pathId: {
    label: string;
    value: string;
  };
  pathName: string;
  workingDirectory: string;
}

// Management Server Type for Dell Isilon
export interface ManagementServerType {
  projectId: string;
  configName: string;
  serverType: "Dell";
  host: string;
  port?: number;
  username: string;
  password: string;
  tlsAccepted?: boolean;
  tlsCertificate?: string;
}

// Certificate Subject/Issuer Type
export interface CertificateSubjectType {
  CN?: string;
  O?: string;
  OU?: string;
  C?: string;
  ST?: string;
  L?: string;
}

// Certificate Response Type from Dell Isilon Management Console
export interface CertificateResponseType {
  isSelfSigned: boolean;
  subject: CertificateSubjectType;
  issuer: CertificateSubjectType;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  fingerprint: string;
  fingerprint256: string;
  subjectAltNames: string[];
  daysRemaining: number;
  isExpired: boolean;
  issuerChain: CertificateSubjectType[];
  certificatePEM: string;
  host: string;
  port: number;
}

// Dell Isilon Parent File Server Type (container for zones)
export interface DellIsilonParentType {
  id?: string;
  parentName: string;  // The name given in "Add File Server" (e.g., "ISILON")
  serverType: "Dell";
  managementHost: string;
  managementUsername: string;
  managementPassword: string;
  certificateAccepted: boolean;
  projectId: string;
  createdAt?: string;
}

// Dell Isilon Zone File Server Type (actual file server in DB)
export interface DellIsilonZoneFileServerType {
  id?: string;
  parentId: string;  // Reference to DellIsilonParentType.id
  zoneName: string;  // e.g., "Zone1"
  zoneId: string;    // e.g., "zone1"
  protocol: "NFS" | "SMB";
  host: string;      // The protocol-specific IP
  userName: string;
  password: string;
  workers: string[];
  serverType: "Dell";
  protocolVersion?: string;
  exportPathSource?: string;
}

// Dell Isilon Create Payload Type
export interface DellIsilonCreatePayloadType {
  // Parent information
  parentName: string;
  projectId: string;
  serverType: "Dell";
  managementHost: string;
  managementUsername: string;
  managementPassword: string;
  certificateFingerprint: string;
  tlsExpiry?: string; // Certificate expiry date
  // Zone file servers - each zone can have 1 or 2 entries (NFS, SMB, or both)
  zones: DellIsilonZonePayloadType[];
}

// Individual Zone Payload
export interface DellIsilonZonePayloadType {
  zoneId: string;           // Zone name (e.g., "System") - used as key
  numericZoneId: number;    // Numeric zone ID from Isilon API (e.g., 1)
  zoneName: string;
  smartConnectSsip?: string;   // SSIP from Isilon API for DNS resolution
  smartConnectDnsZone?: string; // DNS zone from Isilon API for resolver config
  nfs?: {
    host: string;
    userName: string;
    password: string;
    workers: string[];
    protocolVersion?: string;
  };
  smb?: {
    host: string;
    userName: string;
    password: string;
    workers: string[];
  };
}
