import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import { Card, FormFieldInputNew } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import NFSCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/NFSCredentials";
import SMBCredentials from "@modules/storage-servers/file-server/components/steps/Credentials/components/SMBCredentials";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

const Credentials = () => {
  const { hostCredentialsForm, isJobRunning } = useContext(
    CommonFileServerContext
  );

  return (
    <>
      <FormFrame>
        <Card className="mt-4 flex flex-col p-6 w-3/6">
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
        </Card>
      </FormFrame>

      <NFSCredentials />
      <SMBCredentials />
    </>
  );
};

export default Credentials;
