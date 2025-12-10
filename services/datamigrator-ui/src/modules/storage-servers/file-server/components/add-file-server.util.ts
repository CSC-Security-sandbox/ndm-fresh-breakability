import { BlueXpFormType } from "@/types/app.type";
import {
  ConfigPayloadType,
  CredentialsValidationSchemaType,
  FileServerType,
  HostFormType,
  jobConfigFormFormType,
  MountPathsOptionsListType,
  ServerTypeFormType,
  WorkingDirectoryDetailsType,
} from "@modules/storage-servers/file-server/fileServer.interface";
import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";

interface protocolsType {
  type: string;
  username: string;
  password: string;
}

// TODO: CHANGE username and hostname to ----->  userName and hostName (BE Pending)

export const createValidateConnectionPayload = (
  workerIds: string[],
  nfsCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  smbCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  hostCredentialsForm: BlueXpFormType<any>,
  selectedProtocol: 'NFS' | 'SMB',
  serverTypeForm?: BlueXpFormType<ServerTypeFormType>,
  isilonCredentialsForm?: BlueXpFormType<any>
) => {
  const protocols: protocolsType[] = [];

  // Only include the selected protocol
  if (selectedProtocol === 'NFS' && nfsCredentialsForm.isValid) {
    protocols.push({
      type: nfsCredentialsForm.formState?.protocol,
      username: nfsCredentialsForm.formState?.userName,
      password: nfsCredentialsForm.formState?.password,
    });
  }

  if (selectedProtocol === 'SMB' && smbCredentialsForm.isValid) {
    protocols.push({
      type: smbCredentialsForm.formState?.protocol,
      username: smbCredentialsForm.formState?.userName,
      password: smbCredentialsForm.formState?.password,
    });
  }
  
  // Extract serverType from form, default to OtherNAS
  const serverType = serverTypeForm?.formState?.serverType?.value || "OtherNAS";
  
  const fileServer: any = {
    hostname: hostCredentialsForm?.formState?.host.trim(),
    serverType: serverType,
    protocols,
  };

  // Add Dell Isilon API credentials if provided
  if (serverType === "DellIsilon" && isilonCredentialsForm?.formState?.useStorageAPI) {
    fileServer.useStorageAPI = true;
    fileServer.storageApiCredentials = {
      apiEndpoint: isilonCredentialsForm.formState.apiEndpoint || "",
      username: isilonCredentialsForm.formState.apiUsername || "",
      password: isilonCredentialsForm.formState.apiPassword || "",
    };
  }
  
  return {
    fileServer,
    workerIds,
  };
};

export const createConfigPayload = (
  projectId: string,
  serverTypeForm: BlueXpFormType<ServerTypeFormType>,
  nfsCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  smbCredentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  workers: string[],
  hostCredentialsForm: BlueXpFormType<HostFormType>,
  jobConfigForm: BlueXpFormType<jobConfigFormFormType>,
  selectedProtocol: 'NFS' | 'SMB',
  editingFileServerDetails?: any,
  isilonCredentialsForm?: BlueXpFormType<any>
) => {
  const mountPoints: any = [];
  const fileServers: FileServerType[] = [];

  let existingFileServerId = null;
  if (editingFileServerDetails?.fileServers && editingFileServerDetails.fileServers.length > 0) {
    existingFileServerId = editingFileServerDetails.fileServers[0]?.id || null;
  }

  // Create file server for the selected protocol
  if (selectedProtocol === 'NFS') {
    const nfsFileServer = getFileServerDetails(
      serverTypeForm,
      nfsCredentialsForm,
      hostCredentialsForm,
      mountPoints,
      workers,
      existingFileServerId,
      isilonCredentialsForm
    );
    if (nfsFileServer) {
      fileServers.push(nfsFileServer);
    }
  } else if (selectedProtocol === 'SMB') {
    const smbFileServer = getFileServerDetails(
      serverTypeForm,
      smbCredentialsForm,
      hostCredentialsForm,
      mountPoints,
      workers,
      existingFileServerId,
      isilonCredentialsForm
    );
    if (smbFileServer) {
      fileServers.push(smbFileServer);
    }
  }

  const configPayload: ConfigPayloadType = {
    configName: serverTypeForm.formState?.configName || "",
    configType: "FILE",
    projectId,
    fileServers,
    workingDirectory: {
      workingDirectory: jobConfigForm?.formState?.workingDirectory || "",
      pathId:
        !jobConfigForm?.formState?.pathId?.value || jobConfigForm?.formState?.pathId?.value?.length === 0
          ? null
          : jobConfigForm?.formState?.pathId?.value,
      pathName:
        !jobConfigForm?.formState?.pathId?.value || jobConfigForm?.formState?.pathId?.value?.length === 0
          ? jobConfigForm?.formState?.pathName || ""
          : jobConfigForm?.formState?.pathId?.label || "",
    },
  };
  return configPayload;
};

export const patchCredentialsFormValue = (
  protocolValue: CredentialsValidationSchemaType
) => {
  return {
    id: protocolValue.id,
    password: protocolValue?.password || "",
    protocol: protocolValue?.protocol || "",
    userName: protocolValue?.userName || "",
    protocolVersion: protocolValue.protocolVersion,
    exportPathSource:
      protocolValue?.exportPathSource || EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
  };
};

// TODO: password needs to be managed

// HELPER FUNCTIONS
const getFileServerDetails = (
  serverTypeForm: BlueXpFormType<ServerTypeFormType>,
  credentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  hostCredentialsForm: BlueXpFormType<any>,
  volumes: any[],
  workers: string[],
  existingId?: string | null,
  isilonCredentialsForm?: BlueXpFormType<any>
) => {

  if (credentialsForm.isValid && credentialsForm.formState) {
    const hostName = hostCredentialsForm?.formState?.host?.trim() || "";
    const serverType = serverTypeForm?.formState?.serverType?.value || "OtherNAS";
    
    const fileServerDetails: any = {
      serverType: serverType,
      protocol: credentialsForm.formState?.protocol || "",
      userName: credentialsForm.formState?.userName || "",
      password: credentialsForm.formState?.password || "",
      host: hostName,
      protocolVersion: credentialsForm?.formState?.protocolVersion?.value || "",
      exportPathSource: credentialsForm.formState?.exportPathSource || EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
      volumes: volumes || [],
      workers: workers || [], 
    };

    // Add Isilon-specific credentials if Dell Isilon is selected and API is enabled
    if (serverType === "DellIsilon" && isilonCredentialsForm?.formState?.useStorageAPI) {
      fileServerDetails.useStorageAPI = true;
      fileServerDetails.storageApiCredentials = {
        apiEndpoint: isilonCredentialsForm.formState.apiEndpoint || "",
        username: isilonCredentialsForm.formState.apiUsername || "",
        password: isilonCredentialsForm.formState.apiPassword || "",
      };
    } else if (serverType === "DellIsilon") {
      fileServerDetails.useStorageAPI = false;
    }

    if (existingId) {
      fileServerDetails.id = existingId;
    }

    return fileServerDetails;
  }
  
  return null;
};

export const patchJobConfigFormValue = (
  workingDirectory: WorkingDirectoryDetailsType,
  pathsList: MountPathsOptionsListType[]
) => {
  const selectedPath = pathsList?.find(
    (path) => path?.value === workingDirectory?.pathId
  );
  return {
    pathId: selectedPath || null,
    pathName: workingDirectory?.pathName || "",
    workingDirectory: workingDirectory?.workingDirectory || "",
  };
};