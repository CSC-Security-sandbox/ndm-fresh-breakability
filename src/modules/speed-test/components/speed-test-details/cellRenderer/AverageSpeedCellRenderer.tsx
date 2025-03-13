import { memo, useMemo } from "react";
import { calculateAverageSpeed } from "@modules/speed-test/utils/speed-test-details.utils";
import ValueCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/valueCellRenderer";
import { CalculateSpeedPropsType } from "@modules/speed-test/types/speed-test-details.types";

const AverageSpeedCellRenderer = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const averageSpeed: number = useMemo(() => {
    return calculateAverageSpeed({ workers, type });
  }, [workers, type]);

  return <ValueCellRenderer value={averageSpeed} unit={"ms"} />;
};

export default memo(AverageSpeedCellRenderer);
