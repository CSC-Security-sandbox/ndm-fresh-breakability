import { Box } from "@components/container/index";
import { PRECHECK_ERROR_STATUS } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.constants";
import { PreCheckErrorDetailsPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";
import { memo } from "react";

const PreCheckErrorDetails = ({
  index,
  errorKey,
}: PreCheckErrorDetailsPropsType) => {
  const errorMessage = PRECHECK_ERROR_STATUS[errorKey] || errorKey;

  return (
    <Box className="flex flex-row pl-8">
      <Box className="font-medium mr-1 text-sm">{`Error ${index + 1}:`}</Box>
      <Box className="text-sm">{errorMessage}</Box>
    </Box>
  );
};

export default memo(PreCheckErrorDetails);
