import { BlueXpTableRowType } from "@/types/app.type";
import { SpeedTestConfigurationType } from "@modules/speed-test/types/speed-test.types";
import { Box } from "@components/container";
import RemoveNameCellRenderer from "@modules/speed-test/components/speed-test-configuration/cellRenderer/RemoveNameCellRenderer";

const TestsCellRenderer = ({
  row,
}: BlueXpTableRowType<
  SpeedTestConfigurationType,
  SpeedTestConfigurationType
>) => {
  return (
    <>
      <Box className="w-full pr-4">
        {row?.tests.map((test) => test?.label).join(", ")}
      </Box>
      <RemoveNameCellRenderer row={row} />
    </>
  );
};

export default TestsCellRenderer;
