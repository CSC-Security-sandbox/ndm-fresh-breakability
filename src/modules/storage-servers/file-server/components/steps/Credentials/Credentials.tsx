import { CommonFileServerContext } from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import RequiredLabel from "@/app/components/layout/RequiredLabel";
import { FormFieldInputNew } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import FormFrame from "@modules/storage-servers/file-server//components/layout/FormFrame";
import NFSCredentials from "./components/NFSCredentials";
import SMBCredentials from "./components/SMBCredentials";

const Credentials = () => {
  const { hostCredentialsForm, isJobRunning } = useContext(
    CommonFileServerContext
  );

  return (
    <Box className="flex flex-col gap-3">
      <FormFrame>
        <Box className="mt-4 flex flex-col p-6 w-3/6">
          <FormFieldInputNew
            form={hostCredentialsForm}
            name="host"
            disabled={isJobRunning}
            placeholder="Host Name"
            label="Host Name"
          />
        </Box>
      </FormFrame>

      <NFSCredentials />
      <SMBCredentials />
    </Box>
  );
};

export default Credentials;
