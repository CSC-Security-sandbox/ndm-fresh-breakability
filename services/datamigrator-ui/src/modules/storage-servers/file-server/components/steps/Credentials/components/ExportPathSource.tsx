import { Box } from "@components/container";
import { Text } from "@netapp/bxp-design-system-react";
import { useContext } from "react";
import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import ExportPathSourceInfo from "@modules/storage-servers/file-server/components/steps/Credentials/components/ExportPathSourceInfo";
import {
  MANUAL_UPLOAD_INFO,
  RADIO_OPTIONS,
} from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";
import { EXPORT_PATH_SOURCE_ENUM } from "@modules/storage-servers/file-server/components/file-server.constant";
import RadioButtonGroup from "@/components/radio-button/RadioButtonGroup";

const ExportPathSource = () => {
  const { nfsCredentialsForm, isJobRunning, selectedProtocol } = useContext(
    CommonFileServerContext
  );
  const isManualUpload =
    nfsCredentialsForm.formState.exportPathSource ===
    EXPORT_PATH_SOURCE_ENUM.MANUAL_UPLOAD;

  const isDisabled = isJobRunning || selectedProtocol !== 'NFS';

  return (
    <>
      <ExportPathSourceInfo />
      <Box
        className={`border-2 border-gray-300 flex items-center p-5 rounded-md ${
          isManualUpload ? "justify-between" : "gap-20"
        }`}
      >
        <Text> Export Paths Retrieval Mechanism</Text>
        <Box className="flex gap-16">
          <RadioButtonGroup
            disabled={isDisabled}
            options={RADIO_OPTIONS}
            form={nfsCredentialsForm}
            name="exportPathSource"
          />
        </Box>
        {isManualUpload && (
          <Box className="bg-blue-50 flex font-light items-center p-2 text-xs w-2/6">
            {MANUAL_UPLOAD_INFO}
          </Box>
        )}
      </Box>
    </>
  );
};

export default ExportPathSource;
