import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { FormFieldInputNew, Text, Checkbox } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useContext } from "react";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

const IsilonCredentials = () => {
  const { 
    serverTypeForm, 
    isilonCredentialsForm, 
    isJobRunning 
  } = useContext(CommonFileServerContext);

  const selectedServerType = serverTypeForm?.formState?.serverType?.value;

  // Only show this component when Dell Isilon is selected
  if (selectedServerType !== "DellIsilon") {
    return null;
  }

  return (
    <FormFrame>
      <Box className="mt-4 flex flex-col p-6">
        <Text className="text-base font-semibold mb-4">Dell Isilon OneFS API Credentials</Text>
        
        <Box className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md mb-4">
          <InfoIcon className="text-blue-600 mt-0.5 flex-shrink-0" size="16" />
          <Text className="text-sm text-blue-800">
            Configure OneFS API credentials to enable advanced Dell Isilon features like optimized path discovery and native API operations.
            If not provided, standard NFS/SMB protocols will be used.
          </Text>
        </Box>

        <Box className="mb-4">
          <Checkbox
            checked={isilonCredentialsForm?.formState?.useStorageAPI || false}
            onChange={(e: any) => {
              isilonCredentialsForm.resetForm({
                ...isilonCredentialsForm?.formState,
                useStorageAPI: e.target.checked,
              });
            }}
            disabled={isJobRunning}
            name="useStorageAPI"
          >
            Enable OneFS API Integration
          </Checkbox>
        </Box>

        {isilonCredentialsForm?.formState?.useStorageAPI && (
          <Box className="flex flex-col gap-4">
            <FormFieldInputNew
              form={isilonCredentialsForm}
              name="apiEndpoint"
              disabled={isJobRunning}
              placeholder="https://isilon-cluster.example.com:8080"
              label="OneFS API Endpoint"
            />
            
            <FormFieldInputNew
              form={isilonCredentialsForm}
              name="apiUsername"
              disabled={isJobRunning}
              placeholder="API Username"
              label="API Username"
            />
            
            <FormFieldInputNew
              form={isilonCredentialsForm}
              name="apiPassword"
              disabled={isJobRunning}
              placeholder="API Password"
              label="API Password"
              type="password"
            />
          </Box>
        )}
      </Box>
    </FormFrame>
  );
};

export default IsilonCredentials;
