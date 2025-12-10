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
} from "@modules/storage-servers/file-server/components/add-file-server.util";
import { useFileServerForm } from "@modules/storage-servers/file-server/context/useFileServerForm";
import { MountPathsOptionsListType } from "@modules/storage-servers/file-server/fileServer.interface";
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
            value: nfsCredentialsInitialValues.protocolVersion || "",
            label: nfsCredentialsInitialValues.protocolVersion || "",
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

      fileServerForm?.setIsJobRunning(false);
      const isJobRunning = isAnyJobRunReady(editingFileServerDetails);
      fileServerForm?.setIsJobRunning(isJobRunning);
    }, [editingFileServerDetails]);

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
      const payload = createConfigPayload(
        selectedProjectId,
        fileServerForm.serverTypeForm,
        fileServerForm.nfsCredentialsForm,
        fileServerForm.smbCredentialsForm,
        fileServerForm.selectedWorkerIds,
        fileServerForm.hostCredentialsForm,
        fileServerForm.jobConfigForm,
        fileServerForm.selectedProtocol,
        editingFileServerDetails,
        fileServerForm.isilonCredentialsForm
      );

      try {
        updateConfigurationApi({
          id: editingFileServerDetails?.id,
          body: payload,
        })
          .unwrap()
          .then((resp) => {
            if (resp.error) {
              throw new Error("Error creating file server");
            }

            navigate("/file-server");
          })
          .catch((err) => {
            notify.error("Something Went wrong...");
            console.error({ err, level: "Updating config" });
          });
      } catch {
        notify.error("Failed to save configuration.");
      }
    };

    const editFileServerHelpers = {
      handleEditConfiguration,
      ...fileServerForm,
      editingFileServerDetails,
    };

    return <WrappedComponent {...props} {...editFileServerHelpers} />;
  };
}
