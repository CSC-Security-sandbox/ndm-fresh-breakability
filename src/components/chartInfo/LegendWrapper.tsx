import { LegendWrapperPropsType } from "@/types/app.type";
import Legends from "@components/chartInfo/Legends";
import { formattedValue } from "@components/chartInfo/legends.utils";

const LegendWrapper = ({
  title,
  value,
  color,
  unit,
}: LegendWrapperPropsType) => {
  return (
    <Legends
      title={title}
      value={formattedValue(value)}
      color={color}
      unit={unit}
      valueTooltip={value?.length > 3 ? value.concat(" ", unit) : ""}
    />
  );
};

export default LegendWrapper;
