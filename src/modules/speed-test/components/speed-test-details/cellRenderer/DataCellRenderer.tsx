import { memo } from "react";
import { DataCellRendererPropsType } from "src/modules/speed-test/types/speed-test.types";

const DataCellRenderer = ({ value, unit }: DataCellRendererPropsType) => {
  return <>{isNaN(value) ? "-" : `${value} ${unit}`}</>;
};

export default memo(DataCellRenderer);
