import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { FormFieldInputNew, Text, RadioButton } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { useContext } from "react";
import NFSCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/NFSCredentials";
import SMBCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/SMBCredentials";
import IsilonCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/IsilonCredentials";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

const Credentials = () => {
  const {
    hostCredentialsForm,
    isJobRunning,
    selectedProtocol,
    setSelectedProtocol,
    serverTypeForm,
  } = useContext(CommonFileServerContext);

  const selectedServerType = serverTypeForm?.formState?.serverType?.value;
  const isDellIsilon = selectedServerType === "dell";

  console.debug("[Credentials] Render", {
    hostCredentialsForm,
    isJobRunning,
    selectedProtocol,
    serverTypeForm,
    isDellIsilon,
  });

  return (
    <>
      {/* Host Name input - only for Other NAS */}
      {!isDellIsilon && (
        <FormFrame>
          <Box className="mt-4 flex flex-col p-6 w-3/6">
            <FormFieldInputNew
              form={hostCredentialsForm}
              name="host"
              disabled={isJobRunning}
              placeholder="Host Name"
              label="Host Name"
              onBlur={(e: any) => {
                hostCredentialsForm.resetForm({
                  ...hostCredentialsForm?.formState,
                  host: e.target.value.trim(),
                });
              }}
            />
          </Box>
        </FormFrame>
      )}

      {isDellIsilon ? (
        // Dell Isilon: Show Access Zones table with credentials
        <IsilonCredentials />
      ) : (
        // Other NAS: Show Protocol Selection and NFS/SMB credentials
        <>
          <FormFrame>
            <Box className="mt-4 flex flex-col p-6">
              <Text className="text-base font-semibold mb-4">Protocol Selection</Text>
              <Box className="flex gap-4 mb-4">
                <RadioButton
                  checked={selectedProtocol === 'NFS'}
                  onChange={() => setSelectedProtocol('NFS')}
                  disabled={isJobRunning}
                  name="protocol"
                  value="NFS"
                >
                  NFS
                </RadioButton>
                <RadioButton
                  checked={selectedProtocol === 'SMB'}
                  onChange={() => setSelectedProtocol('SMB')}
                  disabled={isJobRunning}
                  name="protocol"
                  value="SMB"
                >
                  SMB
                </RadioButton>
              </Box>
              <Box className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <InfoIcon className="text-blue-600 mt-0.5 flex-shrink-0" size="16" />
                <Text className="text-sm text-blue-800">
                  If your file server supports both NFS and SMB, set up two distinct file servers—one using NFS and another using SMB.
                </Text>
              </Box>
            </Box>
          </FormFrame>

          <NFSCredentials />
          <SMBCredentials />
        </>
      )}
    </>
  );
};

export default Credentials;