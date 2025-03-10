import { TransitionChevron } from "@netapp/bxp-design-system-react";
import { memo } from "react";
import { Box } from "@components/container";
import { calculateAverageSpeed } from "@modules/speed-test/utils/speed-test-details.utils";

const SpeedTestChevronCellRenderer = ({ row, rowState, type }: any) => {
  const averageSpeed = () => {
    const averageValue = calculateAverageSpeed({ workers: row.workers, type });
    return (averageValue / 100).toFixed(2);
  };
  return (
    <Box className="flex flex-row w-full">
      <Box>{averageSpeed()}%</Box>
      <TransitionChevron
        className="ml-auto pr-4"
        isActive={rowState.isExpanded}
        color="grey"
        thin
        wide
      />
    </Box>
  );
};

export default memo(SpeedTestChevronCellRenderer);
