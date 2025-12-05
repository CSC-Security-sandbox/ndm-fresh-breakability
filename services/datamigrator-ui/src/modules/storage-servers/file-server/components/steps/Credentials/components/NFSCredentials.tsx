import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import {
  FormFieldInputNew,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import ProtocolAccordion from "@modules/storage-servers/file-server/components/steps/Credentials/components/ProtocolAccordion";
import { NFS_PROTOCOL_VERSION_OPTIONS } from "@modules/storage-servers/file-server/components/steps/Credentials/credentials.constant";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

const NFSCredentials = () => {
  const { nfsCredentialsForm, isJobRunning, selectedProtocol } = useContext(
    CommonFileServerContext
  );

  const isDisabled = isJobRunning || selectedProtocol !== 'NFS';

  return (
    <FormFrame>
      <ProtocolAccordion title="NFS">
        <FormFieldInputNew
          form={nfsCredentialsForm}
          name="userName"
          placeholder="Username"
          disabled={isDisabled}
          label="Username"
          onBlur={(e: any) => {
            nfsCredentialsForm.resetForm({
              ...nfsCredentialsForm?.formState,
              userName: e.target.value.trim(),
            });
          }}
        />
        <FormFieldInputNew
          form={nfsCredentialsForm}
          name="password"
          placeholder="Password"
          label="Password"
          type="password"
          disabled={isDisabled}
          isOptional
          onBlur={(e: any) => {
            nfsCredentialsForm.resetForm({
              ...nfsCredentialsForm?.formState,
              password: e.target.value.trim(),
            });
          }}
        />
        <FormFieldSelect
          label="Protocol Version"
          name="protocolVersion"
          form={nfsCredentialsForm}
          disabled={isDisabled}
          options={NFS_PROTOCOL_VERSION_OPTIONS}
        />
      </ProtocolAccordion>
    </FormFrame>
  );
};

export default NFSCredentials;
