import { memo, useMemo } from "react";
import { CalculateSpeedPropsType } from "@modules/speed-test/types/speed-test-details.types";
import DataCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/DataCellRenderer";
import {
  calculateAverageSpeed,
  workerErrors,
} from "@modules/speed-test/utils/speed-test.utils";
import { Popover } from "@netapp/bxp-design-system-react";

const AverageSpeedCellRenderer = ({
  workers,
  type,
}: CalculateSpeedPropsType) => {
  const workersError: string = useMemo(() => {
    return workerErrors({ workers });
  }, [workers]);

  const averageSpeed: number = useMemo(() => {
    return calculateAverageSpeed({ workers, type });
  }, [workers, type]);

  if (workersError.length > 0) {
    return <Popover Trigger="error">{workersError}</Popover>;
  }

  return <DataCellRenderer value={averageSpeed} unit={"ms"} />;
};

export default memo(AverageSpeedCellRenderer);
