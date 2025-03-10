import { Box } from "@components/container/index";
import {
  AccordionCard,
  AccordionCardContent,
  AccordionController,
  Popover,
  Tooltip,
} from "@netapp/bxp-design-system-react";
import { nanoid } from "@reduxjs/toolkit";
import { PRECHECK_ERROR_STATUS } from "./review.constants";
import { memo } from "react";
import { getSourcePaths } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Review/Review.utils";
import { PreCheckStatusPropsType } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/components/steps/Review/Review.types";

const PreCheckErrors = ({ errorData }: PreCheckStatusPropsType) => {
  const preCheckErrorData = errorData?.[0]?.status?.errors;
  return (
    <Box className="flex flex-col gap-3">
      {preCheckErrorData?.map((preCheckError: any) => {
        const paths = getSourcePaths(preCheckError?.sourcePathId, errorData);
        const pathInfo = paths?.[0] || { truncatePath: "", path: "" };

        return (
          <AccordionController key={nanoid()}>
            <AccordionCard
              title={
                <Box className="flex flex-row gap-2 text-sm">
                  <Popover Trigger="error">Fail</Popover>
                  <Box>
                    <Tooltip>{pathInfo?.path}</Tooltip>
                    {`${pathInfo?.truncatePath} - ${
                      preCheckError?.errors?.length
                    } ${
                      preCheckError?.errors?.length === 1 ? "Error" : "Errors"
                    }`}
                  </Box>
                </Box>
              }
            >
              <AccordionCardContent>
                {preCheckError?.errors.map((key: string, index: number) => (
                  <Box className="flex flex-row" key={index}>
                    <Box className="font-semibold mr-1">
                      <span className="whitespace-nowrap">{`Error ${
                        index + 1
                      }: `}</span>
                    </Box>
                    <Box>{PRECHECK_ERROR_STATUS[key] || key}</Box>
                  </Box>
                ))}
              </AccordionCardContent>
            </AccordionCard>
          </AccordionController>
        );
      })}
    </Box>
  );
};

export default memo(PreCheckErrors);
