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
    const nfsAndSmbWorkersList: string[] = [];
    const nfsAndSmbVolumeList: MountPathsOptionsListType[] = [];
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

      // Set the selected protocol based on existing file server data
      if (nfsCredentialsInitialValues.id) {
        fileServerForm.setSelectedProtocol('NFS');
      } else if (smbCredentialsInitialValues.id) {
        fileServerForm.setSelectedProtocol('SMB');
      }

      extractWorkersAndVolumes(nfsCredentialsInitialValues);
      extractWorkersAndVolumes(smbCredentialsInitialValues);

      fileServerForm?.jobConfigForm.resetForm(
        patchJobConfigFormValue(
          editingFileServerDetails.workingDirectory,
          nfsAndSmbVolumeList
        )
      );

      fileServerForm?.setIsJobRunning(false);

      fileServerForm?.setSelectedWorkerIds(nfsAndSmbWorkersList);
      // nfsAndSmbVolumeList.forEach();
      fileServerForm?.setMountPaths(nfsAndSmbVolumeList);
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

    //  LOGIC TO PRE SELECT ALL WORKERS - FOR WORKERS SCREEN
    // LOGIC TO GET ALL MOUNT_PATHS TO LIST ON WORKING_DIR
    const extractWorkersAndVolumes = (credentials: FileServerApiType) => {
      credentials?.workers?.forEach((worker) => {
        nfsAndSmbWorkersList.push(worker?.workerId);
      });

      if (credentials?.volumes) {
        nfsAndSmbVolumeList.push(
          ...credentials.volumes
            .filter((volume) => volume?.isValid)
            .map(({ volumePath, id }) => ({ label: volumePath, value: id }))
        );
      }
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
        fileServerForm.selectedProtocol
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
