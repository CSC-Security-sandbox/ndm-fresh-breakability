import { Box } from "@components/container/index";
import {
  FormFieldInputNew,
  FormFieldSelect,
  useWizard,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";
import CertificateDetails from "./CertificateDetails";
import { useLazyGetUniqueFileServerNamesQuery } from "@api/configApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { notify } from "@components/notification/NotificationWrapper";

const ServerType = () => {
  const { 
    serverTypeForm, 
    managementConsoleForm, 
    isJobRunning,
    showCertificateView,
    certificateData,
    handleAcceptCertificate,
    handleDeclineCertificate,
    fetchingCertificate,
    certificateError,
    isEditMode,
    editingFileServerDetails,
  } = useContext(CommonFileServerContext);
  
  const { goToNextStep } = useWizard();
  const [getUniqueFileServerName] = useLazyGetUniqueFileServerNamesQuery();
  const { selectedProjectId } = useSelectedProjectId();
  
  const isDellIsilon = serverTypeForm?.formState?.serverType?.value === "dell";
  
  // In edit mode for Dell Isilon, Host and Server Type should be read-only
  const isDellIsilonEditMode = isEditMode && isDellIsilon;
  
  // Handle accept and navigate to next step (with unique name check)
  const onAcceptAndContinue = async () => {
    // Accept certificate (lazy approach - just store in memory)
    await handleAcceptCertificate();
    
    const configName = serverTypeForm?.formState?.configName;
    const isConfigNameChanged = editingFileServerDetails?.configName !== configName;
    
    // Check unique file server name for new servers or when name changed in edit mode
    if (!isEditMode || (isEditMode && isConfigNameChanged)) {
      try {
        await getUniqueFileServerName({
          projectId: selectedProjectId,
          configName,
        }).unwrap();
        goToNextStep();
      } catch (err: any) {
        console.log(err?.data?.message || "File Server creation error");
        notify.error("File Server Name already exists.");
      }
    } else {
      goToNextStep();
    }
  };
  
  return (
    <FormFrame>
      <Box className="flex gap-4 p-6">
        <FormFieldInputNew
          form={serverTypeForm}
          name="configName"
          placeholder="Name"
          disabled={isJobRunning}
          label="Name"
          onBlur={(e: any) => {
            serverTypeForm.resetForm({
              ...serverTypeForm?.formState,
              configName: e.target.value.trim(),
            });
          }}
        />

        <FormFieldSelect
          form={serverTypeForm}
          name="serverType"
          label="Server Type"
          disabled={isJobRunning || isDellIsilonEditMode}
          options={[
            {
              label: "Other NAS",
              value: "OtherNAS",
            },
            {
              label: "Dell Isilon",
              value: "dell",
            },
          ]}
        />
      </Box>
      
      {/* Management Console Fields - Only shown for Dell Isilon */}
      {isDellIsilon && (
        <Box className="flex flex-col gap-4 p-6 pt-0">
          <Box className="text-sm font-medium text-gray-700 mb-2">
            Management Console
          </Box>
          <Box className="flex gap-4">
            <FormFieldInputNew
              form={managementConsoleForm}
              name="managementHost"
              placeholder="e.g., 10.192.7.32:8080"
              disabled={isJobRunning || isDellIsilonEditMode}
              label="Host"
            />
            <FormFieldInputNew
              form={managementConsoleForm}
              name="managementUsername"
              placeholder="Username"
              disabled={isJobRunning}
              label="Username"
            />
            <FormFieldInputNew
              form={managementConsoleForm}
              name="managementPassword"
              placeholder="Password"
              disabled={isJobRunning}
              label="Password"
              type="password"
            />
          </Box>
        </Box>
      )}
      
      {/* Certificate Modal */}
      <CertificateDetails
        certificate={certificateData}
        onAccept={onAcceptAndContinue}
        onDecline={handleDeclineCertificate}
        isLoading={fetchingCertificate}
        isOpen={showCertificateView}
        error={certificateError}
      />
    </FormFrame>
  );
};

export default ServerType;
