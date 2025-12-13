import {
  BlueXpFormType,
  GetAllWorkersApiType,
  ValidateConnectionApiType,
} from "@/types/app.type";
import { ReactNode } from "react";

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
  userName: string;
  host: string;
  password: string;
  workers: string[];
  createdBy?: string;
}

export interface ConfigPayloadType {
  id?: string;
  projectId: string;
  configName: string;
  configType: string;
  fileServers: FileServerType[];
  createdBy?: string;
  workingDirectory: WorkingDirectoryDetailsType;
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
