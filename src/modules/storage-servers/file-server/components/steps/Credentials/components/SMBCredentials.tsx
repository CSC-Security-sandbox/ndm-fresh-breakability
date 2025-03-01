import FormFrame from "@modules/storage-servers/file-server//components/layout/FormFrame";
import { CommonFileServerContext } from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import RequiredLabel from "@/app/components/layout/RequiredLabel";
import {
  FormFieldInputNew,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import ProtocolAccordion from "./ProtocolAccordion";
import { SMB_PROTOCOL_VERSION_OPTIONS } from "../credentials.constant";
const SMBCredentials = () => {
  const { smbCredentialsForm, hostCredentialsForm, isJobRunning } = useContext(
    CommonFileServerContext
  );

  return (
    <FormFrame>
      <ProtocolAccordion title="SMB">
        <FormFieldInputNew
          form={smbCredentialsForm}
          name="userName"
          placeholder="Username"
          disabled={isJobRunning}
          label="Username"
        />
        <FormFieldInputNew
          form={smbCredentialsForm}
          name="password"
          placeholder="Password"
          type="password"
          label="Password"
          disabled={isJobRunning}
        />
        <FormFieldSelect
          label="Protocol Version"
          name="protocolVersion"
          placeholder="Protocol Version"
          form={smbCredentialsForm}
          disabled={isJobRunning}
          options={SMB_PROTOCOL_VERSION_OPTIONS}
        />
      </ProtocolAccordion>
    </FormFrame>
  );
};

export default SMBCredentials;
