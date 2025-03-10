import { memo } from "react";
import { Box } from "@components/container";
import { calculateAverageSpeed } from "@modules/speed-test/utils/speed-test-details.utils";

const AverageSpeedCellRenderer = ({ workers, type }: any) => {
  return <Box>{calculateAverageSpeed({ workers, type })} ms</Box>;
};

export default memo(AverageSpeedCellRenderer);
