import { Box } from "@components/container/index";
import { nanoid } from "@reduxjs/toolkit";
import { memo } from "react";
import PreCheckErrorAccordion from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/PreCheckErrorAccordion";
import { PreCheckStatusPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/PreCheck/pre-check.types";

const PreCheckErrors = ({ errorData }: PreCheckStatusPropsType) => {
  const preCheckErrorData = errorData?.[0]?.status?.errors ?? [];

  return (
    <Box className="flex flex-col gap-3">
      {preCheckErrorData.map((preCheckError: any) => (
        <PreCheckErrorAccordion
          key={nanoid()}
          errorData={errorData}
          preCheckError={preCheckError}
        />
      ))}
    </Box>
  );
};

export default memo(PreCheckErrors);
