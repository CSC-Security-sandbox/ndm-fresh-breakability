import { Box } from "@components/container/index";
import { Text } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import ExportPathSourceInfo from "@modules/storage-servers/file-server/components/steps/Credentials/components/ExportPathSourceInfo";
import { RADIO_OPTIONS } from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";
import RadioButtonGroup from "@components/RadioButton/RadioButtonGroup";

const ExportPathSource = () => {
  const { nfsCredentialsForm } = useContext(CommonFileServerContext);
  return (
    <>
      <ExportPathSourceInfo />
      <Box className="flex gap-20 border-2 border-gray-300 rounded-md p-5">
        <Text>Path Retrieval Mechanism</Text>
        <Box className="flex gap-16">
          <RadioButtonGroup
            options={RADIO_OPTIONS}
            form={nfsCredentialsForm}
            name="exportPathSource"
            style="flex gap-16"
          />
        </Box>
      </Box>
    </>
  );
};

export default ExportPathSource;
