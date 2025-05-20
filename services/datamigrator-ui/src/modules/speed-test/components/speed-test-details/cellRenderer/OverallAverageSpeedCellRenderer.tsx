import { memo, useMemo } from "react";
import { calculateOverallAverageSpeed } from "@modules/speed-test/utils/speed-test-details.utils";
import { WorkerSpeedActionPropsType } from "@modules/speed-test/types/speed-test-details.types";
import DataCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/DataCellRenderer";

const OverallAverageSpeedCellRenderer = ({
  workers,
  speedAction,
}: WorkerSpeedActionPropsType) => {
  const overallAverageSpeed: number = useMemo(() => {
    return calculateOverallAverageSpeed({ workers, speedAction });
  }, [workers, speedAction]);

  return <DataCellRenderer value={overallAverageSpeed} unit={"Mbps"} />;
};

export default memo(OverallAverageSpeedCellRenderer);
