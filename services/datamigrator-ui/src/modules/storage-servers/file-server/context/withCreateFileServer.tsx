import { useCreateFileServerMutation } from "@api/configApi";
import { notify } from "@components/notification/NotificationWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { 
  createConfigPayload, 
  createDellIsilonConfigPayload,
  flattenDellIsilonPayloadToConfigs 
} from "@modules/storage-servers/file-server/components/add-file-server.util";
import { useFileServerForm } from "@modules/storage-servers/file-server/context/useFileServerForm";
import { ComponentType } from "react";
import { useNavigate } from "react-router-dom";

export function withCreateFileServer(WrappedComponent: ComponentType<any>) {
  return function WithCreateFileServerComponent(props: any) {
    const { selectedProjectId } = useSelectedProjectId();
    const navigate = useNavigate();
    const [createConfigurationApi] = useCreateFileServerMutation();
    const fileServerForm = useFileServerForm();

    // CREATE NEW FILE SERVER (handles both Other NAS and Dell Isilon)
    const handleCreateConfiguration = async () => {
      try {
        fileServerForm?.setDisableNextButton(true);
        
        const isDellIsilon = fileServerForm.serverTypeForm?.formState?.serverType?.value === "dell";
        
        if (isDellIsilon) {
          // Dell Isilon: Create multiple file servers (one per zone/protocol)
          await handleCreateDellIsilonConfiguration();
        } else {
          // Other NAS: Create single file server
          await handleCreateOtherNASConfiguration();
        }
        
        notify.success("Configuration Successfully saved...");
        navigate("/file-server");
      } catch (err) {
        notify.error("Error creating file server.");
        console.error({ error: err, level: "Creating Config" });
      } finally {
        fileServerForm?.setDisableNextButton(false);
      }
    };

    // Create Other NAS file server (existing logic)
    const handleCreateOtherNASConfiguration = async () => {
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

      const resp = await createConfigurationApi(payload);

      if (resp.error) {
        throw new Error("Error creating file server");
      }
    };

    // Create Dell Isilon file server (single config with multiple file servers)
    const handleCreateDellIsilonConfiguration = async () => {
      // Build zone metadata from selectedZoneIds - zone name IS the zone ID
      const zonesMetadata = (fileServerForm.selectedZoneIds || []).map((zoneId: string) => ({
        id: zoneId,
        name: zoneId, // Zone name is the same as zone ID (zoneName from API)
      }));
      
      // Build Dell Isilon payload
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
      
      console.log("[Dell Isilon] Created payload:", dellPayload);
      
      // Create single config with all file servers (parent-child structure)
      // - configName = parent name (e.g., "NEWWW2")
      // - fileServers[] = all zones with fileServerName = zone name (e.g., "System")
      const config = flattenDellIsilonPayloadToConfigs(dellPayload);
      
      console.log("[Dell Isilon] Single config payload:", config);
      
      if (config.fileServers.length === 0) {
        throw new Error("No valid zone configurations found");
      }
      
      // Create the single configuration
      const resp = await createConfigurationApi(config);
      if (resp.error) {
        console.error("[Dell Isilon] Error creating config:", config.configName, resp.error);
        throw new Error(`Error creating file server: ${config.configName}`);
      }
      
      console.log("[Dell Isilon] Configuration created successfully");
    };

    const createFileServerHelpers = {
      ...fileServerForm,
      handleCreateConfiguration,
    };

    return <WrappedComponent {...props} {...createFileServerHelpers} />;
  };
}
