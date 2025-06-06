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
  hostCredentialsForm: BlueXpFormType<any>
) => {
  const protocols: protocolsType[] = [];

  if (nfsCredentialsForm.isValid) {
    protocols.push({
      type: nfsCredentialsForm.formState?.protocol,
      username: nfsCredentialsForm.formState?.userName,
      password: nfsCredentialsForm.formState?.password,
    });
  }

  if (smbCredentialsForm.isValid) {
    protocols.push({
      type: smbCredentialsForm.formState?.protocol,
      username: smbCredentialsForm.formState?.userName,
      password: smbCredentialsForm.formState?.password,
    });
  }
  return {
    fileServer: {
      hostname: hostCredentialsForm?.formState?.host.trim(),
      protocols,
    },
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
  jobConfigForm: BlueXpFormType<jobConfigFormFormType>
) => {
  const mountPoints: any = [];
  const fileServers: FileServerType[] = [
    getFileServerDetails(
      serverTypeForm,
      nfsCredentialsForm,
      hostCredentialsForm,
      mountPoints,
      workers
    ),
    getFileServerDetails(
      serverTypeForm,
      smbCredentialsForm,
      hostCredentialsForm,
      mountPoints,
      workers
    ),
  ].filter(Boolean);

  const configPayload: ConfigPayloadType = {
    configName: serverTypeForm.formState?.configName,
    configType: "FILE",
    projectId,
    fileServers,
    workingDirectory: {
      workingDirectory: jobConfigForm?.formState?.workingDirectory,
      pathId:
        jobConfigForm?.formState.pathId?.value.length === 0
          ? null
          : jobConfigForm?.formState?.pathId?.value,
      pathName:
        jobConfigForm?.formState.pathId?.value.length === 0
          ? jobConfigForm?.formState?.pathName
          : jobConfigForm?.formState?.pathId?.label,
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
      protocolValue?.exportPathSource || EXPORT_PATH_SOURCE_ENUM.SHOW_MOUNT,
  };
};

// TODO: password needs to be managed

// HELPER FUNCTIONS
const getFileServerDetails = (
  serverTypeForm: BlueXpFormType<ServerTypeFormType>,
  credentialsForm: BlueXpFormType<CredentialsValidationSchemaType>,
  hostCredentialsForm: BlueXpFormType<any>,
  volumes: any[],
  workers: string[]
) => {
  if (credentialsForm.dirty && credentialsForm.isValid) {
    const hostName = hostCredentialsForm?.formState.host.trim();
    return {
      serverType: serverTypeForm?.formState?.serverType?.value,
      ...credentialsForm.formState,
      host: hostName,
      protocolVersion: credentialsForm?.formState.protocolVersion?.value,
      password: credentialsForm.formState?.password,
      volumes,
      workers,
    };
  }
};

export const patchJobConfigFormValue = (
  workingDirectory: WorkingDirectoryDetailsType,
  pathsList: MountPathsOptionsListType[]
) => {
  const selectedPath = pathsList.find(
    (path) => path?.value === workingDirectory?.pathId
  );
  return {
    pathId: selectedPath,
    pathName: workingDirectory?.pathName || "",
    workingDirectory: workingDirectory?.workingDirectory || "",
  };
};
