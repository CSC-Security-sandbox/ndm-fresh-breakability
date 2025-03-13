import { memo } from "react";
import { valueCellRendererPropsType } from "@modules/speed-test/types/speed-test.types";

const valueCellRenderer = ({ value, unit }: valueCellRendererPropsType) => {
  return <>{isNaN(value) ? "-" : `${value} ${unit}`}</>;
};

export default memo(valueCellRenderer);
