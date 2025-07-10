import { Text } from "@netapp/bxp-design-system-react";
import { Box } from "@/components/container";
import { ErrorIcon } from "@netapp/bxp-style/react-icons/Notification";
import { BulkManualUploadErrorPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

const BulkManualUploadError = ({ error }: BulkManualUploadErrorPropsType) => {
  return (
    <Box className="flex">
      <ErrorIcon color="error" className="w-4" />
      <Text className="font-semibold ml-1"> Error: </Text>
      <Text className="ml-1 text-sm">{error}</Text>
    </Box>
  );
};

export default BulkManualUploadError;
