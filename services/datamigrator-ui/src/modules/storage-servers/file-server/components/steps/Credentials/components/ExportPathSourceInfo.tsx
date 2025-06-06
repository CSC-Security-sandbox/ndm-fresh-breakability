import { Box } from "@components/container";
import { Text } from "@netapp/bxp-design-system-react";
import { InfoIcon } from "@netapp/bxp-style/react-icons/Notification";

const ExportPathSourceInfo = () => {
  return (
    <Box className="inline-flex items-center gap-2">
      <InfoIcon className="text-gray-500" />
      <Text className="text-base font-semibold">Note:</Text>
      <Text className="text-base">
        Use Manual Upload only for GCNV Flex service, or if
        <code> showmount</code> is not supported.
      </Text>
    </Box>
  );
};

export default ExportPathSourceInfo;
