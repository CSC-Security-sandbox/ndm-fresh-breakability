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

// Hardcoded Dell Isilon zones (should be moved to shared constant)
const DELL_ISILON_ZONES = [
  { id: "zone1", name: "Zone1" },
  { id: "zone2", name: "Zone2" },
];

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

    // Create Dell Isilon file servers (multiple entries for zones)
    const handleCreateDellIsilonConfiguration = async () => {
      // Build Dell Isilon payload
      const dellPayload = createDellIsilonConfigPayload(
        selectedProjectId,
        fileServerForm.serverTypeForm,
        fileServerForm.managementConsoleForm,
        fileServerForm.selectedZoneIds || [],
        fileServerForm.zoneCredentials || {},
        fileServerForm.zoneWorkerAssignments || {},
        fileServerForm.certificateData,
        DELL_ISILON_ZONES
      );
      
      console.log("[Dell Isilon] Created payload:", dellPayload);
      
      // Flatten to individual file server configs
      const configs = flattenDellIsilonPayloadToConfigs(dellPayload);
      
      console.log("[Dell Isilon] Flattened to configs:", configs);
      
      if (configs.length === 0) {
        throw new Error("No valid zone configurations found");
      }
      
      // Create each file server
      const results = await Promise.all(
        configs.map(async (config) => {
          // Strip out dellIsilonMetadata before sending to API
          // The metadata is only for UI grouping, not for the backend
          const { dellIsilonMetadata: _metadata, ...apiPayload } = config as any;
          
          console.log("[Dell Isilon] Original config:", config);
          console.log("[Dell Isilon] Stripped metadata:", _metadata);
          console.log("[Dell Isilon] API payload (should NOT have dellIsilonMetadata):", apiPayload);
          console.log("[Dell Isilon] Has dellIsilonMetadata?:", 'dellIsilonMetadata' in apiPayload);
          
          const resp = await createConfigurationApi(apiPayload);
          if (resp.error) {
            console.error("[Dell Isilon] Error creating:", apiPayload.configName, resp.error);
            throw new Error(`Error creating file server: ${apiPayload.configName}`);
          }
          return resp;
        })
      );
      
      console.log("[Dell Isilon] All file servers created:", results.length);
    };

    const createFileServerHelpers = {
      ...fileServerForm,
      handleCreateConfiguration,
    };

    return <WrappedComponent {...props} {...createFileServerHelpers} />;
  };
}
