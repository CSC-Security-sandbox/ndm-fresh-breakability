import { DetailsTilePropsType } from "@modules/speed-test/types/speed-test.types";
import SpeedTestDetailsStatusRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/SpeedTestDetailsStatusRenderer";
import SpeedDetailsCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/SpeedDetailsCellRenderer";
import { Box } from "@components/container";
import { calculateTimeDiff } from "@/utils/common.utils";
import TimeElapsedRenderer from "@components/custom-cell-renderer/TimeElapsedRenderer";
import { SPEED_TEST_ENUM } from "@modules/speed-test/constants/speed-test.constants";
import { memo } from "react";

const DetailsTile = ({
  title,
  value,
  startTime,
  endTime,
}: DetailsTilePropsType) => {
  const renderValue = () => {
    switch (title) {
      case "status":
        return <SpeedTestDetailsStatusRenderer status={value} />;
      case "startTime":
      case "endTime":
        return <SpeedDetailsCellRenderer value={String(value)} />;
      case "jobRunId":
        return <Box className="font-semibold">{value}</Box>;
      case "timeElapsed":
        if (startTime && endTime) {
          const timeDiff = calculateTimeDiff(startTime, endTime);
          return <TimeElapsedRenderer value={timeDiff} />;
        }
        return "N/A";
      default:
        return value;
    }
  };

  return (
    <Box className="flex flex-col p-3 space-y-2">
      <Box className="text-gray-500 text-sm">
        {SPEED_TEST_ENUM[title as keyof typeof SPEED_TEST_ENUM]}
      </Box>
      <Box className="text-sm">{renderValue()}</Box>
    </Box>
  );
};

export default memo(DetailsTile);
