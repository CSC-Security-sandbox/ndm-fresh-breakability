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
  ZoneCredentialsType,
  ZoneWorkerAssignmentsType,
  DellIsilonCreatePayloadType,
  DellIsilonZonePayloadType,
  ManagementConsoleFormType,
  CertificateResponseType,
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
  selectedProtocol: 'NFS' | 'SMB'
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
  jobConfigForm: BlueXpFormType<jobConfigFormFormType>,
  selectedProtocol: 'NFS' | 'SMB',
  editingFileServerDetails?: any
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
      existingFileServerId
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
      existingFileServerId
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
  existingId?: string | null
) => {

  if (credentialsForm.isValid && credentialsForm.formState) {
    const hostName = hostCredentialsForm?.formState?.host?.trim() || "";
    
 
    const fileServerDetails: any = {
      serverType: serverTypeForm?.formState?.serverType?.value || "OtherNAS",
      protocol: credentialsForm.formState?.protocol || "",
      userName: credentialsForm.formState?.userName || "",
      password: credentialsForm.formState?.password || "",
      host: hostName,
      protocolVersion: credentialsForm?.formState?.protocolVersion?.value || "",
      exportPathSource: credentialsForm.formState?.exportPathSource || EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
      volumes: volumes || [],
      workers: workers || [], 
    };

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

/**
 * Create Dell Isilon File Server Payload
 * 
 * Dell Isilon has a parent-child structure:
 * - Parent: The Dell Isilon container (metadata only - name, management IP, etc.)
 * - Children (Zones): The actual file servers with NFS/SMB credentials
 * 
 * Each zone can have:
 * - NFS only → 1 file server entry
 * - SMB only → 1 file server entry
 * - Both NFS and SMB → 2 file server entries (separate NFS and SMB file servers)
 * 
 * @example
 * Parent: "ISILON"
 * ├── Zone1 (NFS only) → Creates: ISILON-Zone1-NFS
 * ├── Zone2 (SMB only) → Creates: ISILON-Zone2-SMB
 * └── Zone3 (Both) → Creates: ISILON-Zone3-NFS, ISILON-Zone3-SMB
 */
export const createDellIsilonConfigPayload = (
  projectId: string,
  serverTypeForm: BlueXpFormType<ServerTypeFormType>,
  managementConsoleForm: BlueXpFormType<ManagementConsoleFormType>,
  selectedZoneIds: string[],
  zoneCredentials: Record<string, ZoneCredentialsType>,
  zoneWorkerAssignments: Record<string, ZoneWorkerAssignmentsType>,
  certificateData: CertificateResponseType | null,
  zonesMetadata: { id: string; name: string }[]
): DellIsilonCreatePayloadType => {
  const parentName = serverTypeForm.formState?.configName || "";
  
  // Build zone payloads
  const zones: DellIsilonZonePayloadType[] = selectedZoneIds.map((zoneId) => {
    const zoneMeta = zonesMetadata.find((z) => z.id === zoneId);
    const creds = zoneCredentials[zoneId] || {};
    const workers = zoneWorkerAssignments[zoneId] || { nfs: [], smb: [] };
    
    const zonePayload: DellIsilonZonePayloadType = {
      zoneId,
      zoneName: zoneMeta?.name || zoneId,
    };
    
    // Add NFS config if present
    if (creds.nfsIp && creds.nfsUsername && creds.nfsPassword) {
      zonePayload.nfs = {
        host: creds.nfsIp,
        userName: creds.nfsUsername,
        password: creds.nfsPassword,
        workers: workers.nfs || [],
        protocolVersion: "v3", // Default NFS version - must match backend enum (v3, v4.0, v4.1, v4.2)
      };
    }
    
    // Add SMB config if present
    if (creds.smbIp && creds.smbUsername && creds.smbPassword) {
      zonePayload.smb = {
        host: creds.smbIp,
        userName: creds.smbUsername,
        password: creds.smbPassword,
        workers: workers.smb || [],
      };
    }
    
    return zonePayload;
  });
  
  return {
    parentName,
    projectId,
    serverType: "dell",
    managementHost: managementConsoleForm.formState?.managementHost || "",
    managementUsername: managementConsoleForm.formState?.managementUsername || "",
    managementPassword: managementConsoleForm.formState?.managementPassword || "",
    certificateFingerprint: certificateData?.fingerprint256 || "",
    zones,
  };
};

/**
 * Convert Dell Isilon payload to standard ConfigPayloadType array
 * This flattens the zone structure into individual file server configs
 * that can be sent to the existing API
 * 
 * Each zone with NFS → 1 config payload
 * Each zone with SMB → 1 config payload
 * Each zone with both → 2 config payloads
 */
export const flattenDellIsilonPayloadToConfigs = (
  dellPayload: DellIsilonCreatePayloadType
): ConfigPayloadType[] => {
  const configs: ConfigPayloadType[] = [];
  
  for (const zone of dellPayload.zones) {
    // Create NFS file server if zone has NFS
    if (zone.nfs) {
      const nfsConfig: ConfigPayloadType = {
        configName: `${dellPayload.parentName}-${zone.zoneName}-NFS`,
        configType: "FILE",
        projectId: dellPayload.projectId,
        fileServers: [{
          serverType: "dell",
          protocol: "NFS",
          userName: zone.nfs.userName,
          password: zone.nfs.password,
          host: zone.nfs.host,
          workers: zone.nfs.workers,
          protocolVersion: zone.nfs.protocolVersion,
        }],
        workingDirectory: {
          workingDirectory: "",
          pathId: null,
          pathName: "",
        },
        // Custom Dell Isilon metadata
        dellIsilonMetadata: {
          parentName: dellPayload.parentName,
          zoneId: zone.zoneId,
          zoneName: zone.zoneName,
          managementHost: dellPayload.managementHost,
          serverType: "dell",
        },
      } as ConfigPayloadType & { dellIsilonMetadata: any };
      
      configs.push(nfsConfig);
    }
    
    // Create SMB file server if zone has SMB
    if (zone.smb) {
      const smbConfig: ConfigPayloadType = {
        configName: `${dellPayload.parentName}-${zone.zoneName}-SMB`,
        configType: "FILE",
        projectId: dellPayload.projectId,
        fileServers: [{
          serverType: "dell",
          protocol: "SMB",
          userName: zone.smb.userName,
          password: zone.smb.password,
          host: zone.smb.host,
          workers: zone.smb.workers,
        }],
        workingDirectory: {
          workingDirectory: "",
          pathId: null,
          pathName: "",
        },
        // Custom Dell Isilon metadata
        dellIsilonMetadata: {
          parentName: dellPayload.parentName,
          zoneId: zone.zoneId,
          zoneName: zone.zoneName,
          managementHost: dellPayload.managementHost,
          serverType: "dell",
        },
      } as ConfigPayloadType & { dellIsilonMetadata: any };
      
      configs.push(smbConfig);
    }
  }
  
  return configs;
};

/**
 * Group file servers by Dell Isilon parent for display in File Server List
 * This takes the flat list of file servers and groups them by parent name
 */
export const groupDellIsilonFileServers = (
  fileServers: any[]
): { parents: any[]; regularServers: any[] } => {
  const dellIsilonMap = new Map<string, any>();
  const regularServers: any[] = [];
  
  for (const server of fileServers) {
    const metadata = server.dellIsilonMetadata;
    
    if (metadata && metadata.serverType === "dell") {
      // Dell Isilon file server - group by parent
      const parentName = metadata.parentName;
      
      if (!dellIsilonMap.has(parentName)) {
        dellIsilonMap.set(parentName, {
          configName: parentName,
          serverType: "dell",
          managementHost: metadata.managementHost,
          isDellIsilonParent: true,
          zones: [],
          // Use the earliest createdAt
          createdAt: server.createdAt,
        });
      }
      
      const parent = dellIsilonMap.get(parentName);
      
      // Find or create zone entry
      let zoneEntry = parent.zones.find((z: any) => z.zoneId === metadata.zoneId);
      if (!zoneEntry) {
        zoneEntry = {
          zoneId: metadata.zoneId,
          zoneName: metadata.zoneName,
          fileServers: [],
        };
        parent.zones.push(zoneEntry);
      }
      
      // Add file server to zone
      zoneEntry.fileServers.push(server);
    } else {
      // Regular file server
      regularServers.push(server);
    }
  }
  
  return {
    parents: Array.from(dellIsilonMap.values()),
    regularServers,
  };
};
