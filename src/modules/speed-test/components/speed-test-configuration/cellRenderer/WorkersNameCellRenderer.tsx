import { BlueXpTableRowType } from "@/types/app.type";
import { SpeedTestConfigurationType } from "@modules/speed-test/types/speed-test.types";
import { Box } from "@components/container";

const WorkersNameCellRenderer = ({
  row,
}: BlueXpTableRowType<
  SpeedTestConfigurationType,
  SpeedTestConfigurationType
>) => {
  const [firstWorker, ...remainingWorkers] = row.workers;

  return (
    <Box>
      {remainingWorkers.length > 0 ? (
        <>
          {`${firstWorker.label}, `}
          <span className="text-primary">{`+${remainingWorkers.length}`}</span>
        </>
      ) : (
        firstWorker.label
      )}
    </Box>
  );
};

export default WorkersNameCellRenderer;
