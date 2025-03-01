import FormFrame from "@modules/storage-servers/file-server//components/layout/FormFrame";
import { CommonFileServerContext } from "@modules/storage-servers/file-server//context/CommonFileServerContextProvider";
import RequiredLabel from "@/app/components/layout/RequiredLabel";
import {
  FormFieldInputNew,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import ProtocolAccordion from "./ProtocolAccordion";
import { NFS_PROTOCOL_VERSION_OPTIONS } from "../credentials.constant";

const NFSCredentials = () => {
  const { nfsCredentialsForm, isJobRunning } = useContext(
    CommonFileServerContext
  );

  return (
    <FormFrame>
      <ProtocolAccordion title="NFS">
        <FormFieldInputNew
          form={nfsCredentialsForm}
          name="userName"
          placeholder="Username"
          disabled={isJobRunning}
          label="Username"
        />
        <FormFieldInputNew
          form={nfsCredentialsForm}
          name="password"
          placeholder="Password"
          label="Password"
          type="password"
          disabled={isJobRunning}
          isOptional
        />
        <FormFieldSelect
          label="Protocol Version"
          name="protocolVersion"
          form={nfsCredentialsForm}
          disabled={isJobRunning}
          options={NFS_PROTOCOL_VERSION_OPTIONS}
        />
      </ProtocolAccordion>
    </FormFrame>
  );
};

export default NFSCredentials;
