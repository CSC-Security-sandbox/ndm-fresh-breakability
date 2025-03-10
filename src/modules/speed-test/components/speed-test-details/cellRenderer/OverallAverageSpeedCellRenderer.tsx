import { memo } from "react";
import { Box } from "@components/container";
import { calculateOverallAverageSpeed } from "@modules/speed-test/utils/speed-test-details.utils";

const OverallAverageSpeedCellRenderer = ({ workers, speedAction }: any) => {
  return (
    <Box>{calculateOverallAverageSpeed({ workers, speedAction })} Mbps</Box>
  );
};

export default memo(OverallAverageSpeedCellRenderer);
