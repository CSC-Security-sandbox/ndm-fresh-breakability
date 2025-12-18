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
  ManagementServerType,
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

  // Get serverType from form, convert to backend enum format
  const serverTypeValue = serverTypeForm?.formState?.serverType?.value;
  // Map frontend values to backend enum: "dell" -> "Dell", "other" -> "OtherNAS"
  const backendServerType = serverTypeValue === "dell" ? "Dell" : "OtherNAS";

  const configPayload: ConfigPayloadType = {
    configName: serverTypeForm.formState?.configName || "",
    configType: "FILE",
    projectId,
    serverType: backendServerType, // Required by backend
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
    // For Other NAS: send empty/null management fields
    managementHost: "",
    managementPort: undefined,
    managementUsername: "",
    managementPassword: "",
    tlsAccepted: null,
    tlsCertificate: "",
    tlsExpiry: "",
    // Note: createdBy is set by the backend from the authenticated user
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
    
    // Get protocolVersion value - only include if it has a valid non-empty value
    const protocolVersionValue = credentialsForm?.formState?.protocolVersion?.value;
       // Convert frontend serverType to backend enum format
    const frontendServerType = serverTypeForm?.formState?.serverType?.value;
    const backendServerType = frontendServerType === "dell" ? "Dell" : "OtherNAS";
    
    // Build fileServerName from config name and protocol
    const configName = serverTypeForm?.formState?.configName || "";
    const protocol = credentialsForm.formState?.protocol || "";
    const fileServerName = `${configName}-${protocol}`;
 
    const fileServerDetails: any = {
      serverType: backendServerType,
      protocol: protocol,
      fileServerName: fileServerName,
      userName: credentialsForm.formState?.userName || "",
      password: credentialsForm.formState?.password || "",
      host: hostName,
      zone_id: null, // Other NAS doesn't have zones, set to null
      exportPathSource: credentialsForm.formState?.exportPathSource || EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
      volumes: volumes || [],
      workers: workers || [],
      // Note: createdBy is set by the backend from the authenticated user
    };

    // Only include protocolVersion if it has a valid non-empty value
    if (protocolVersionValue && protocolVersionValue.trim() !== "") {
      fileServerDetails.protocolVersion = protocolVersionValue;
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
      numericZoneId: creds.numericZoneId || 1, // Numeric zone ID from Isilon API (default to 1 for System)
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
    serverType: "Dell",
    managementHost: managementConsoleForm.formState?.managementHost || "",
    managementUsername: managementConsoleForm.formState?.managementUsername || "",
    managementPassword: managementConsoleForm.formState?.managementPassword || "",
    certificateFingerprint: certificateData?.certificatePEM || "", // Full certificate PEM
    tlsExpiry: certificateData?.validTo || "", // Certificate expiry date
    zones,
  };
};

/**
 * Convert Dell Isilon payload to a single ConfigPayloadType
 * 
 * Creates ONE config with:
 * - configName = parent name (e.g., "NEWWW2")
 * - fileServers[] = all zones/protocols with fileServerName = zone name (e.g., "System")
 * 
 * This maintains the parent-child (management console → zone) structure
 */
export const flattenDellIsilonPayloadToConfigs = (
  dellPayload: DellIsilonCreatePayloadType
): ConfigPayloadType => {
  const fileServers: any[] = [];
  
  for (const zone of dellPayload.zones) {
    // Create NFS file server if zone has NFS
    if (zone.nfs) {
      fileServers.push({
        serverType: "Dell",
        protocol: "NFS",
        protocolVersion: zone.nfs.protocolVersion || "v3",
        fileServerName: zone.zoneName, // Zone name (e.g., "System")
        host: zone.nfs.host,
        userName: zone.nfs.userName,
        password: zone.nfs.password,
        zone_id: zone.numericZoneId, // Numeric zone ID (e.g., 1)
        exportPathSource: "AUTO_DISCOVER",
        workers: zone.nfs.workers || [],
        // Note: createdBy is set by the backend from the authenticated user
      });
    }
    
    // Create SMB file server if zone has SMB
    if (zone.smb) {
      fileServers.push({
        serverType: "Dell",
        protocol: "SMB",
        protocolVersion: "v3.0",
        fileServerName: zone.zoneName, // Zone name (e.g., "System")
        host: zone.smb.host,
        userName: zone.smb.userName,
        password: zone.smb.password,
        zone_id: zone.numericZoneId, // Numeric zone ID (e.g., 1)
        exportPathSource: "AUTO_DISCOVER",
        workers: zone.smb.workers || [],
        // Note: createdBy is set by the backend from the authenticated user
      });
    }
  }
  
  // Create a single config with all file servers
  const config: ConfigPayloadType = {
    projectId: dellPayload.projectId,
    configName: dellPayload.parentName, // Parent name (e.g., "NEWWW2")
    configType: "FILE",
    serverType: "Dell",
    workingDirectory: {
      workingDirectory: "",
      pathId: null,
      pathName: "",
    },
    fileServers: fileServers,
    // Dell Isilon management fields at root level
    managementHost: dellPayload.managementHost,
    managementPort: 8080, // Default port
    managementUsername: dellPayload.managementUsername,
    managementPassword: dellPayload.managementPassword,
    tlsAccepted: true,
    tlsCertificate: dellPayload.certificateFingerprint,
    tlsExpiry: dellPayload.tlsExpiry,
    // Note: createdBy is set by the backend from the authenticated user
  };
  
  return config;
};

/**
 * Group file servers by Dell Isilon parent for display in File Server List
 * 
 * NEW STRUCTURE:
 * - configName = parent name (e.g., "NEWWW2")
 * - fileServers[].fileServerName = zone name (e.g., "System")
 * - fileServers[].protocol = "NFS" or "SMB"
 * 
 * This function:
 * 1. Identifies Dell Isilon configs by checking serverType === "Dell"
 * 2. Uses configName as the parent name
 * 3. Groups fileServers by zone (fileServerName) and protocol
 */
export const groupDellIsilonFileServers = (
  fileServers: any[]
): { parents: any[]; regularServers: any[] } => {
  const dellIsilonMap = new Map<string, any>();
  const regularServers: any[] = [];
  
  for (const server of fileServers) {
    // Check if this is a Dell Isilon config
    const serverType = server.serverType || server.fileServers?.[0]?.serverType;
    const isDellIsilon = serverType === "Dell" || serverType === "dell";
    
    if (isDellIsilon && server.fileServers && server.fileServers.length > 0) {
      // configName IS the parent name (e.g., "NEWWW2")
      const parentName = server.configName || "";
      
      // Create or get parent entry
      if (!dellIsilonMap.has(parentName)) {
        dellIsilonMap.set(parentName, {
          id: server.id, // Config ID
          configName: parentName,
          serverType: "Dell",
          isDellIsilonParent: true,
          zones: [],
          createdAt: server.createdAt,
          zoneServerCount: 0,
          // Keep original server reference for actions
          _originalServer: server,
        });
      }
      
      const parent = dellIsilonMap.get(parentName);
      
      // Update createdAt to earliest date
      if (server.createdAt && (!parent.createdAt || new Date(server.createdAt) < new Date(parent.createdAt))) {
        parent.createdAt = server.createdAt;
      }
      
      // Process each file server (zone + protocol combination)
      for (const fs of server.fileServers) {
        // fileServerName IS the zone name (e.g., "System")
        const zoneName = fs.fileServerName || fs.name || "Unknown";
        const protocol = fs.protocol || "NFS";
        
        parent.zoneServerCount++;
        
        // Find or create zone entry
        let zoneEntry = parent.zones.find((z: any) => z.zoneName === zoneName);
        if (!zoneEntry) {
          zoneEntry = {
            zoneName: zoneName,
            zoneId: fs.zone_id || zoneName.toLowerCase(),
            fileServers: [],
          };
          parent.zones.push(zoneEntry);
        }
        
        // Add file server to zone with protocol info
        zoneEntry.fileServers.push({
          ...fs,
          _protocol: protocol,
          _zoneName: zoneName,
          _parentName: parentName,
          _configId: server.id, // Reference to parent config
          // Inherit status and errorMessage from parent config
          status: fs.status || server.status,
          errorMessage: fs.errorMessage || server.errorMessage,
        });
      }
    } else {
      // Regular file server (Other NAS, etc.)
      regularServers.push(server);
    }
  }
  
  return {
    parents: Array.from(dellIsilonMap.values()),
    regularServers,
  };
};
