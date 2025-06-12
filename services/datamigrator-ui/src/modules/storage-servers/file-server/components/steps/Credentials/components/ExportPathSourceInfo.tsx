import { Box } from "@components/container";
import { Text } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";

const ExportPathSourceInfo = () => (
  <Box className="inline-flex items-center gap-2">
    <InfoIcon className="text-gray-500" />
    <Text className="text-base font-semibold">Note:</Text>
    <Text className="text-base">
      Use manual upload if showmount is not supported, such as with GCNV Flex
      service, or if you prefer to upload the files manually.
    </Text>
  </Box>
);

export default ExportPathSourceInfo;
