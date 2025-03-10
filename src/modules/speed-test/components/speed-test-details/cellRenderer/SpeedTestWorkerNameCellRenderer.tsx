import { memo } from "react";
import { Box } from "@components/container";
import { SpeedTestPropsType } from "@modules/speed-test/types/speed-test-details.types";
import { BlueXpTableRowType } from "@/types/app.type";

const SpeedTestWorkerNameCellRenderer = ({
  row,
}: BlueXpTableRowType<SpeedTestPropsType, any>) => {
  const [firstWorker, ...remainingWorkers] = row.workers.map(
    (e) => e.workerName
  );

  return (
    <Box>
      {remainingWorkers.length > 0 ? (
        <>
          {`${firstWorker}, `}
          <span className="text-primary">{`+${remainingWorkers.length}`}</span>
        </>
      ) : (
        firstWorker
      )}
    </Box>
  );
};

export default memo(SpeedTestWorkerNameCellRenderer);
