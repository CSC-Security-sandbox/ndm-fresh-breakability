import { useCreateFileServerMutation } from "@api/configApi";
import { notify } from "@components/notification/NotificationWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { createConfigPayload } from "@modules/storage-servers/file-server/components/add-file-server.util";
import { useFileServerForm } from "@modules/storage-servers/file-server/context/useFileServerForm";
import { ComponentType } from "react";
import { useNavigate } from "react-router-dom";

export function withCreateFileServer(WrappedComponent: ComponentType<any>) {
  return function WithCreateFileServerComponent(props: any) {
    const { selectedProjectId } = useSelectedProjectId();
    const navigate = useNavigate();
    const [createConfigurationApi] = useCreateFileServerMutation();
    const fileServerForm = useFileServerForm();

    // CREATE NEW FILE SERVER
    const handleCreateConfiguration = async () => {
      try {
        fileServerForm?.setDisableNextButton(true);
        const payload = createConfigPayload(
          selectedProjectId,
          fileServerForm.serverTypeForm,
          fileServerForm.nfsCredentialsForm,
          fileServerForm.smbCredentialsForm,
          fileServerForm.selectedWorkerIds,
          fileServerForm.hostCredentialsForm,
          fileServerForm.jobConfigForm,
          fileServerForm.selectedProtocol,
          undefined,
          fileServerForm.isilonCredentialsForm
        );

        const resp = await createConfigurationApi(payload);

        if (resp.error) {
          throw new Error("Error creating file server");
        }
        notify.success("Configuration Successfully saved...");
        navigate("/file-server");
      } catch (err) {
        notify.error("Error creating file server.");

        console.error({ error: err, level: "Creating Config" });
      }
    };

    const createFileServerHelpers = {
      ...fileServerForm,
      handleCreateConfiguration,
    };

    return <WrappedComponent {...props} {...createFileServerHelpers} />;
  };
}
