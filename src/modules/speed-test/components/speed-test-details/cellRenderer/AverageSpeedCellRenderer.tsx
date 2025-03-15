import { memo, useMemo } from "react";
import { CalculateSpeedPropsType } from "@modules/speed-test/types/speed-test-details.types";
import DataCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/DataCellRenderer";
import { calculateAverageSpeed } from "@modules/speed-test/utils/speed-test.utils";

const AverageSpeedCellRenderer = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const averageSpeed: number = useMemo(() => {
    return calculateAverageSpeed({ workers, type });
  }, [workers, type]);

  return <DataCellRenderer value={averageSpeed} unit={"ms"} />;
};

export default memo(AverageSpeedCellRenderer);
