import { LegendWrapperPropsType } from "@/types/app.type";
import Legends from "@components/chartInfo/Legends";

const LegendWrapper = ({
  title,
  value,
  color,
  unit,
}: LegendWrapperPropsType) => {
  return (
    <Legends
      title={title}
      value={value?.length > 3 ? value.slice(0, 4) : value}
      color={color}
      unit={unit}
      valueTooltip={value?.length > 3 ? value.concat(" ", unit) : ""}
    />
  );
};

export default LegendWrapper;
