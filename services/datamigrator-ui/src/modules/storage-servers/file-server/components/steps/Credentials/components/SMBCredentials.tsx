import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import {
  FormFieldInputNew,
  FormFieldSelect,
  Popover,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { SMB_PROTOCOL_VERSION_OPTIONS } from "@modules/storage-servers/file-server/components/steps/Credentials/credentials.constant";
import ProtocolAccordion from "@modules/storage-servers/file-server/components/steps/Credentials/components/ProtocolAccordion";

const SMBCredentials = () => {
  const { smbCredentialsForm, isJobRunning, selectedProtocol } = useContext(
    CommonFileServerContext
  );

  const isDisabled = isJobRunning || selectedProtocol !== "SMB";

  return (
    <FormFrame>
      <ProtocolAccordion title="SMB">
        <FormFieldInputNew
          form={smbCredentialsForm}
          name="adServerIp"
          placeholder="AD Server IP"
          disabled={isDisabled}
          label="AD Server IP"
          onBlur={(e: any) => {
            smbCredentialsForm.resetForm({
              ...smbCredentialsForm?.formState,
              adServerIp: e.target.value?.trim() ?? "",
            });
          }}
        />
        <FormFieldInputNew
          form={smbCredentialsForm}
          name="userName"
          placeholder="Username"
          disabled={isDisabled}
          label="Username"
          labelChildren={
            <Popover placement="right" verticalPlacement="center">
              Username of user who is part of backup operator group
            </Popover>
          }
          onBlur={(e: any) => {
            smbCredentialsForm.resetForm({
              ...smbCredentialsForm?.formState,
              userName: e.target.value.trim(),
            });
          }}
        />
        <FormFieldInputNew
          form={smbCredentialsForm}
          name="password"
          placeholder="Password"
          type="password"
          label="Password"
          disabled={isDisabled}
          labelChildren={
            <Popover placement="right" verticalPlacement="center">
              Password of user who is part of backup operator group
            </Popover>
          }
          onBlur={(e: any) => {
            smbCredentialsForm.resetForm({
              ...smbCredentialsForm?.formState,
              password: e.target.value.trim(),
            });
          }}
        />
        <FormFieldSelect
          label="Protocol Version"
          name="protocolVersion"
          placeholder="Protocol Version"
          isOptional
          form={smbCredentialsForm}
          disabled={isDisabled}
          options={SMB_PROTOCOL_VERSION_OPTIONS}
        />
      </ProtocolAccordion>
    </FormFrame>
  );
};

export default SMBCredentials;
