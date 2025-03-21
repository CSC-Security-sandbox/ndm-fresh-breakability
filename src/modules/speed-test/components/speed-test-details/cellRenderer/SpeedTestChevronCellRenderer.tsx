import { TransitionChevron } from "@netapp/bxp-design-system-react";
import { memo, useMemo } from "react";
import { Box } from "@components/container";
import { percentageFormatter } from "@modules/speed-test/utils/speed-test-details.utils";
import DataCellRenderer from "@modules/speed-test/components/speed-test-details/cellRenderer/DataCellRenderer";

const SpeedTestChevronCellRenderer = ({ row, rowState, type }: any) => {
  const averageSpeed: number = useMemo(() => {
    return percentageFormatter({
      workers: row?.workers,
      type,
    });
  }, [row.workers, type]);

  return (
    <Box className="flex flex-row w-full">
      <DataCellRenderer value={averageSpeed} unit={"%"} />
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
