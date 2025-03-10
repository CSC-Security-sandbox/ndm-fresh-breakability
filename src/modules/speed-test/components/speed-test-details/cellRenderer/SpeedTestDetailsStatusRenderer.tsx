import { Box } from "@components/container";
import { SPEED_TEST_DETAILS_STATUS } from "@modules/speed-test/constants/speed-test.constants";
import { SpeedTestDetailsStatusRendererPropsType } from "@modules/speed-test/types/speed-test.types";
import { memo } from "react";

const SpeedTestDetailsStatusRenderer = ({
  status,
}: SpeedTestDetailsStatusRendererPropsType) => {
  const statusIndicator =
    SPEED_TEST_DETAILS_STATUS[
      (status as string).toUpperCase() as keyof typeof SPEED_TEST_DETAILS_STATUS
    ];

  return (
    <Box className="flex gap-2 items-center">
      <span
        className={`w-3 h-3 rounded-full inline-block ${statusIndicator}`}
      ></span>
      <Box>{status}</Box>
    </Box>
  );
};

export default memo(SpeedTestDetailsStatusRenderer);
