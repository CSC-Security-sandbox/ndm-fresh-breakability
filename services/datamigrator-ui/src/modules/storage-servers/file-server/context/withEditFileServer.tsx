import {
  FileServerApiType,
  FileServerDetailsType,
  JOB_STATUS_TYPE_ENUM,
} from "@/types/app.type";
import {
  useLazyGetFileServerByIdQuery,
  useUpdateFileServerMutation,
} from "@api/configApi";
import { notify } from "@components/notification/NotificationWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import {
  createConfigPayload,
  patchCredentialsFormValue,
  patchJobConfigFormValue,
  createDellIsilonConfigPayload,
  flattenDellIsilonPayloadToConfigs,
} from "@modules/storage-servers/file-server/components/add-file-server.util";
import { useFileServerForm } from "@modules/storage-servers/file-server/context/useFileServerForm";
import { MountPathsOptionsListType, ZoneCredentialsType, ZoneWorkerAssignmentsType } from "@modules/storage-servers/file-server/fileServer.interface";
import { ComponentType, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";

export function withEditFileServer(WrappedComponent: ComponentType<any>) {
  return function WithEditFileServerComponent(props: any) {
    const { selectedProjectId } = useSelectedProjectId();
    const navigate = useNavigate();
    const [editingFileServerDetails, setEditingFileServerDetails] = useState(
      {} as FileServerDetailsType
    );

    // MAIN FORM PROVIDER
    const fileServerForm = useFileServerForm();
    const [updateConfigurationApi] = useUpdateFileServerMutation();

    // API
    const [getFileServerDetailsByIdApi] = useLazyGetFileServerByIdQuery();

    // GET THE FILE SERVER DETAILS TO EDIT
    useEffect(() => {
      if (fileServerForm?.fileServerId) {
        (async () => {
          fileServerForm?.setIsEditMode(true);
          const resp: FileServerDetailsType = await getFileServerDetailsByIdApi(
            { fileServerId: fileServerForm?.fileServerId }
          )
            .unwrap()
            .catch((error) => {
              notify.error("Error Fetching Details.");
              console.error(error);
            });
          setEditingFileServerDetails(resp);
        })();
      }
    }, [fileServerForm?.fileServerId]);

    // THIS IS MAIN LOGIC WHERE WE PRE SET VALUES TO ALL FORMS TO EDIT, FILE SERVER
    useEffect(() => {
      if (!editingFileServerDetails?.id) return;

      // Check serverType from the config level (API now returns this)
      // serverType is "Dell" or "dell" for Dell Isilon, "other" for Other NAS
      const serverType = editingFileServerDetails?.serverType;
      const isDellIsilon = serverType === "Dell" || serverType === "dell";

      if (isDellIsilon) {
        // DELL ISILON EDIT MODE PRE-FILLING
        prefillDellIsilonForms();
      } else {
        // OTHER NAS EDIT MODE PRE-FILLING
        prefillOtherNASForms();
      }

      fileServerForm?.setIsJobRunning(false);
      const isJobRunning = isAnyJobRunReady(editingFileServerDetails);
      fileServerForm?.setIsJobRunning(isJobRunning);
    }, [editingFileServerDetails]);

    // Pre-fill forms for Other NAS (existing logic)
    const prefillOtherNASForms = () => {
      // STEP 1 FORM PRE FILLING
      fileServerForm.serverTypeForm.resetForm({
        configName: editingFileServerDetails?.configName || "",
        serverType: {
          value: "OtherNAS",
          label: "Other NAS",
        },
      });

      // STEP 2 FORM PRE FILLING
      const nfsCredentialsInitialValues =
        editingFileServerDetails?.fileServers?.find(
          (fileServer: any) => fileServer?.protocol === "NFS"
        ) || ({} as FileServerApiType);

      const smbCredentialsInitialValues =
        editingFileServerDetails?.fileServers?.find(
          (fileServer: any) => fileServer?.protocol === "SMB"
        ) || ({} as FileServerApiType);

      fileServerForm.nfsCredentialsForm.resetForm(
        patchCredentialsFormValue({
          ...nfsCredentialsInitialValues,
          protocol: "NFS",
          protocolVersion: {
            value: nfsCredentialsInitialValues.protocolVersion || "v3",
            label: nfsCredentialsInitialValues.protocolVersion || "v3",
          },
          exportPathSource:
            nfsCredentialsInitialValues.exportPathSource ||
            EXPORT_PATH_SOURCE_ENUM.AUTO_DISCOVER,
        })
      );

      fileServerForm.smbCredentialsForm.resetForm(
        patchCredentialsFormValue({
          ...smbCredentialsInitialValues,
          protocol: "SMB",
          protocolVersion: {
            value: smbCredentialsInitialValues.protocolVersion || "",
            label: smbCredentialsInitialValues.protocolVersion || "",
          },
        })
      );

      fileServerForm.hostCredentialsForm.resetForm({
        host: editingFileServerDetails?.fileServers?.[0]?.host,
      });

      // Determine the current protocol and set it
      let currentProtocol: 'NFS' | 'SMB' = 'NFS';
      if (nfsCredentialsInitialValues.id) {
        currentProtocol = 'NFS';
      } else if (smbCredentialsInitialValues.id) {
        currentProtocol = 'SMB';
      }
      
      fileServerForm.setSelectedProtocol(currentProtocol);
      fileServerForm.setOriginalProtocol(currentProtocol);

      // Extract workers and volumes for both protocols and store them separately
      const { workers: nfsWorkers, volumes: nfsVolumes } = extractWorkersAndVolumes(nfsCredentialsInitialValues);
      const { workers: smbWorkers, volumes: smbVolumes } = extractWorkersAndVolumes(smbCredentialsInitialValues);

      // Store original workers by protocol
      fileServerForm.setOriginalNfsWorkers(nfsWorkers);
      fileServerForm.setOriginalSmbWorkers(smbWorkers);

      // Set current workers and volumes based on current protocol
      let currentWorkers: string[] = [];
      let currentVolumes: MountPathsOptionsListType[] = [];
      
      if (currentProtocol === 'NFS') {
        currentWorkers = nfsWorkers;
        currentVolumes = nfsVolumes;
      } else if (currentProtocol === 'SMB') {
        currentWorkers = smbWorkers;
        currentVolumes = smbVolumes;
      }

      // Set the extracted workers and volumes
      fileServerForm?.setSelectedWorkerIds(currentWorkers);
      fileServerForm?.setMountPaths(currentVolumes);

      fileServerForm?.jobConfigForm.resetForm(
        patchJobConfigFormValue(
          editingFileServerDetails.workingDirectory,
          currentVolumes
        )
      );
    };

    // Pre-fill forms for Dell Isilon (new logic)
    const prefillDellIsilonForms = () => {
      // STEP 1 FORM PRE FILLING - Server Type
      fileServerForm.serverTypeForm.resetForm({
        configName: editingFileServerDetails?.configName || "",
        serverType: {
          value: "dell",
          label: "Dell Isilon",
        },
      });

      // Management Console Form - prepopulate with existing data
      // Note: Password will be empty for security
      // API returns hostname/username, but form uses managementHost/managementUsername
      fileServerForm.managementConsoleForm.resetForm({
        managementHost: editingFileServerDetails?.hostname || "",
        managementUsername: editingFileServerDetails?.username || "",
        managementPassword: "", // Password is always empty for security in edit mode
      });

      // Set certificate data if available (for display purposes)
      // API returns tlsCaCertificate, but form uses certificatePEM
      if (editingFileServerDetails?.tlsCaCertificate) {
        fileServerForm.setCertificateData({
          certificatePEM: editingFileServerDetails?.tlsCaCertificate || "",
          validTo: editingFileServerDetails?.tlsExpiry || "",
          validFrom: "",
          issuer: "",
          subject: "",
          fingerprint: "",
        });
        fileServerForm.setCertificateAccepted(true);
      }

      // STEP 2 FORM PRE FILLING - Zone Credentials
      // Group file servers by zone (fileServerName is the zone name)
      const zoneMap = new Map<string, {
        nfs?: FileServerApiType;
        smb?: FileServerApiType;
        numericZoneId?: number;
      }>();

      editingFileServerDetails?.fileServers?.forEach((fs: any) => {
        const zoneName = fs.fileServerName || "";
        if (!zoneMap.has(zoneName)) {
          zoneMap.set(zoneName, {});
        }
        const zoneData = zoneMap.get(zoneName)!;
        if (fs.protocol === "NFS") {
          zoneData.nfs = fs;
        } else if (fs.protocol === "SMB") {
          zoneData.smb = fs;
        }
        // Store numeric zone ID
        if (fs.zone_id !== undefined) {
          zoneData.numericZoneId = fs.zone_id;
        }
      });

      // Build selectedZoneIds and zoneCredentials from existing data
      const selectedZoneIds: string[] = [];
      const zoneCredentials: Record<string, ZoneCredentialsType> = {};
      const zoneWorkerAssignments: Record<string, ZoneWorkerAssignmentsType> = {};
      const originalZoneCredentials: Record<string, ZoneCredentialsType> = {};

      zoneMap.forEach((zoneData, zoneName) => {
        selectedZoneIds.push(zoneName);
        
        // Build credentials for this zone
        const creds: ZoneCredentialsType = {
          numericZoneId: zoneData.numericZoneId,
        };

        // NFS credentials
        if (zoneData.nfs) {
          creds.nfsIp = zoneData.nfs.host || "";
          creds.nfsUsername = zoneData.nfs.userName || "";
          creds.nfsPassword = ""; // Password empty for security
        }

        // SMB credentials
        if (zoneData.smb) {
          creds.smbIp = zoneData.smb.host || "";
          creds.smbUsername = zoneData.smb.userName || "";
          creds.smbPassword = ""; // Password empty for security
        }

        zoneCredentials[zoneName] = creds;
        originalZoneCredentials[zoneName] = { ...creds }; // Store original for comparison

        // Build worker assignments for this zone
        const workerAssignments: ZoneWorkerAssignmentsType = {
          nfs: [],
          smb: [],
        };

        if (zoneData.nfs?.workers) {
          workerAssignments.nfs = zoneData.nfs.workers.map((w: any) => w.workerId);
        }
        if (zoneData.smb?.workers) {
          workerAssignments.smb = zoneData.smb.workers.map((w: any) => w.workerId);
        }

        zoneWorkerAssignments[zoneName] = workerAssignments;
      });

      // Set zone state
      fileServerForm.setSelectedZoneIds(selectedZoneIds);
      fileServerForm.setZoneCredentials(zoneCredentials);
      fileServerForm.setZoneWorkerAssignments(zoneWorkerAssignments);
      
      // Store original zone credentials for edit mode validation
      // This will be used in IsilonCredentials to determine which zones/protocols are configured
      (fileServerForm as any).originalZoneCredentials = originalZoneCredentials;
      (fileServerForm as any).originalSelectedZoneIds = [...selectedZoneIds];
    };

    const isAnyJobRunReady = (
      editingFileServerDetails: FileServerDetailsType
    ) => {
      return editingFileServerDetails?.fileServers?.some((server) =>
        server?.volumes?.some((volume) =>
          volume?.jobConfig?.some((job) =>
            job?.jobRunDetails?.some((detail) =>
              [
                JOB_STATUS_TYPE_ENUM.RUNNING.toString(),
                JOB_STATUS_TYPE_ENUM.READY.toString(),
                JOB_STATUS_TYPE_ENUM.PENDING.toString(),
              ].includes(detail?.status)
            )
          )
        )
      );
    };

    // Update the extractWorkersAndVolumes function to return both workers and volumes
    const extractWorkersAndVolumes = (credentials: FileServerApiType) => {
      const workers: string[] = [];
      const volumes: MountPathsOptionsListType[] = [];

      // Extract workers
      credentials?.workers?.forEach((worker) => {
        workers.push(worker?.workerId);
      });

      // Extract volumes
      if (credentials?.volumes) {
        volumes.push(
          ...credentials.volumes
            .filter((volume) => volume?.isValid)
            .map(({ volumePath, id }) => ({ 
              label: volumePath, 
              value: id, 
              volumePath: volumePath 
            }))
        );
      }

      return { workers, volumes };
    };

    const handleEditConfiguration = async () => {
      const serverType = fileServerForm.serverTypeForm?.formState?.serverType?.value;
      const isDellIsilon = serverType === "dell";

      try {
        fileServerForm?.setDisableNextButton(true);
        
        if (isDellIsilon) {
          await handleEditDellIsilonConfiguration();
        } else {
          await handleEditOtherNASConfiguration();
        }
        
        notify.success("Configuration Successfully updated...");
        navigate("/file-server");
      } catch (err) {
        notify.error("Error updating file server.");
        console.error({ error: err, level: "Updating Config" });
      } finally {
        fileServerForm?.setDisableNextButton(false);
      }
    };

    // Edit Other NAS file server (existing logic)
    const handleEditOtherNASConfiguration = async () => {
      const payload = createConfigPayload(
        selectedProjectId,
        fileServerForm.serverTypeForm,
        fileServerForm.nfsCredentialsForm,
        fileServerForm.smbCredentialsForm,
        fileServerForm.selectedWorkerIds,
        fileServerForm.hostCredentialsForm,
        fileServerForm.jobConfigForm,
        fileServerForm.selectedProtocol,
        editingFileServerDetails
      );

      const resp = await updateConfigurationApi({
        id: editingFileServerDetails?.id,
        body: payload,
      }).unwrap();

      if (resp.error) {
        throw new Error("Error updating file server");
      }
    };

    // Edit Dell Isilon file server
    const handleEditDellIsilonConfiguration = async () => {
      console.log("[Dell Isilon Edit] ===== STARTING EDIT CONFIGURATION =====");
      console.log("[Dell Isilon Edit] Input state:", {
        selectedZoneIds: fileServerForm.selectedZoneIds,
        zoneCredentialsKeys: Object.keys(fileServerForm.zoneCredentials || {}),
        zoneWorkerAssignmentsKeys: Object.keys(fileServerForm.zoneWorkerAssignments || {}),
      });
      
      // Log detailed credentials for each zone
      (fileServerForm.selectedZoneIds || []).forEach((zoneId: string) => {
        const creds = fileServerForm.zoneCredentials?.[zoneId] || {};
        const workers = fileServerForm.zoneWorkerAssignments?.[zoneId] || { nfs: [], smb: [] };
        console.log(`[Dell Isilon Edit] Zone "${zoneId}" credentials:`, {
          nfsIp: creds.nfsIp,
          nfsUsername: creds.nfsUsername,
          nfsPassword: creds.nfsPassword ? '(set)' : '(empty)',
          smbIp: creds.smbIp,
          smbUsername: creds.smbUsername,
          smbPassword: creds.smbPassword ? '(set)' : '(empty)',
          numericZoneId: creds.numericZoneId,
          nfsWorkers: workers.nfs,
          smbWorkers: workers.smb,
        });
      });
      
      // Build zone metadata from selectedZoneIds
      const zonesMetadata = (fileServerForm.selectedZoneIds || []).map((zoneId: string) => ({
        id: zoneId,
        name: zoneId,
      }));

      // Build Dell Isilon payload using updated zone credentials and worker assignments
      const dellPayload = createDellIsilonConfigPayload(
        selectedProjectId,
        fileServerForm.serverTypeForm,
        fileServerForm.managementConsoleForm,
        fileServerForm.selectedZoneIds || [],
        fileServerForm.zoneCredentials || {},
        fileServerForm.zoneWorkerAssignments || {},
        fileServerForm.certificateData,
        zonesMetadata
      );

      console.log("[Dell Isilon Edit] Created payload:", dellPayload);
      console.log("[Dell Isilon Edit] Zones in payload:", dellPayload.zones?.map((z: any) => ({
        zoneId: z.zoneId,
        hasNfs: !!z.nfs,
        hasSmb: !!z.smb,
      })));

      // Flatten to config format
      const config = flattenDellIsilonPayloadToConfigs(dellPayload);

      // Preserve existing file server IDs for zones that already exist
      // This ensures the backend can properly update instead of creating new records
      const existingFileServersMap = new Map<string, any>();
      editingFileServerDetails?.fileServers?.forEach((fs: any) => {
        const key = `${fs.fileServerName}-${fs.protocol}`;
        existingFileServersMap.set(key, fs);
      });
      
      console.log("[Dell Isilon Edit] Existing file servers map:", 
        Array.from(existingFileServersMap.entries()).map(([key, fs]) => ({
          key,
          id: fs.id,
          fileServerName: fs.fileServerName,
          protocol: fs.protocol,
        }))
      );

      // Update file servers with existing IDs where applicable
      // For new file servers (no existing ID), explicitly set id to null
      config.fileServers = config.fileServers.map((fs: any) => {
        const key = `${fs.fileServerName}-${fs.protocol}`;
        const existingFs = existingFileServersMap.get(key);
        if (existingFs) {
          console.log(`[Dell Isilon Edit] Preserving ID for existing file server: ${key} -> ${existingFs.id}`);
          return {
            ...fs,
            id: existingFs.id, // Preserve existing file server ID
          };
        }
        console.log(`[Dell Isilon Edit] New file server (no existing ID): ${key} - setting id to null`);
        // Explicitly set id to null for new file servers so backend knows to create them
        return {
          ...fs,
          id: null,
        };
      });

      console.log("[Dell Isilon Edit] Final config payload:", config);
      console.log("[Dell Isilon Edit] File servers to send:", config.fileServers.map((fs: any) => ({
        id: fs.id || '(new)',
        fileServerName: fs.fileServerName,
        protocol: fs.protocol,
        host: fs.host,
        userName: fs.userName,
        hasPassword: !!fs.password,
        workersCount: fs.workers?.length || 0,
      })));

      if (config.fileServers.length === 0) {
        throw new Error("No valid zone configurations found");
      }

      // Update the configuration
      const resp = await updateConfigurationApi({
        id: editingFileServerDetails?.id,
        body: config,
      }).unwrap();

      if (resp.error) {
        throw new Error("Error updating Dell Isilon file server");
      }

      console.log("[Dell Isilon Edit] Configuration updated successfully");
    };

    const editFileServerHelpers = {
      handleEditConfiguration,
      ...fileServerForm,
      editingFileServerDetails,
    };

    return <WrappedComponent {...props} {...editFileServerHelpers} />;
  };
}
