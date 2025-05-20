import { BlueXpTableRowType } from "@/types/app.type";
import { SpeedTestConfigurationType } from "@modules/speed-test/types/speed-test.types";
import { Box } from "@components/container";

const SpeedTestProtocolNameCellRenderer = ({
  row,
}: BlueXpTableRowType<
  SpeedTestConfigurationType,
  SpeedTestConfigurationType
>) => {
  return <Box>{row?.protocol.map((e) => e?.label).join(", ")}</Box>;
};

export default SpeedTestProtocolNameCellRenderer;
