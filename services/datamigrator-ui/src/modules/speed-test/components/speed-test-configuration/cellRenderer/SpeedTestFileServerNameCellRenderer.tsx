import { BlueXpTableRowType } from "@/types/app.type";
import { SpeedTestConfigurationType } from "@modules/speed-test/types/speed-test.types";

const SpeedTestFileServerNameCellRenderer = ({
  row,
}: BlueXpTableRowType<
  SpeedTestConfigurationType,
  SpeedTestConfigurationType
>) => {
  return <>{row?.fileServer?.label}</>;
};

export default SpeedTestFileServerNameCellRenderer;
