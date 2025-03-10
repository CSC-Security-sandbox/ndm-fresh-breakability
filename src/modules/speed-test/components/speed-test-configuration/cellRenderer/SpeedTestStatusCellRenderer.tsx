import { memo } from "react";
import { BlueXpTableRowType } from "@/types/app.type";
import { SPEED_TEST_DETAILS_STATUS } from "@modules/speed-test/constants/speed-test.constants";
import { Box } from "@components/container";
import { toTitleCase } from "@/utils/common.utils";

const SpeedTestStatusCellRenderer = ({ row }: BlueXpTableRowType<any, any>) => {
  const statusIndicator =
    SPEED_TEST_DETAILS_STATUS[
      (
        row.status as string
      ).toUpperCase() as keyof typeof SPEED_TEST_DETAILS_STATUS
    ];

  return (
    <Box className="flex gap-2 items-center">
      <span
        className={`w-3 h-3 rounded-full inline-block ${statusIndicator}`}
      ></span>
      <Box>{toTitleCase(row?.status)}</Box>
    </Box>
  );
};

export default memo(SpeedTestStatusCellRenderer);
