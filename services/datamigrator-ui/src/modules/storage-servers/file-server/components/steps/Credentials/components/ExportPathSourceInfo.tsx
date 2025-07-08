import { Box } from "@components/container";
import { Text } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";
import { EXPORT_PATH_SOURCE_NOTE } from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";

const ExportPathSourceInfo = () => (
  <Box className="inline-flex items-center gap-2">
    <InfoIcon className="text-gray-500" />
    <Text className="text-base font-semibold">Note:</Text>
    <Text className="text-base">{EXPORT_PATH_SOURCE_NOTE}</Text>
  </Box>
);

export default ExportPathSourceInfo;
