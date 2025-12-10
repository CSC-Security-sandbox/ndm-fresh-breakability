import { Box } from "@components/container/index";
import {
  FormFieldInputNew,
  FormFieldSelect,
} from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import FormFrame from "@modules/storage-servers/file-server/components/layout/FormFrame";

const ServerType = () => {
  const { serverTypeForm, isJobRunning } = useContext(CommonFileServerContext);
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
          disabled={isJobRunning}
          options={[
            {
              label: "Other NAS",
              value: "OtherNAS",
            },
            {
              label: "Dell Isilon",
              value: "DellIsilon",
            },
          ]}
        />
      </Box>
    </FormFrame>
  );
};

export default ServerType;
