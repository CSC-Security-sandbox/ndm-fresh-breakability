import { LegendWrapperPropsType } from "@/types/app.type";
import Legends from "@components/chartInfo/Legends";
import {
  truncateLargeNumber,
  legendWrapperTooltipFormatter,
} from "@components/chartInfo/legends.utils";
import { memo } from "react";

const LegendWrapper = ({
  title,
  value,
  color,
  unit,
}: LegendWrapperPropsType) => {
  return (
    <Legends
      title={unit ? `(${unit}) ${title}` : title}
      value={truncateLargeNumber(value)}
      color={color}
      unit={unit}
      valueTooltip={legendWrapperTooltipFormatter(value, unit)}
    />
  );
};

export default memo(LegendWrapper);
