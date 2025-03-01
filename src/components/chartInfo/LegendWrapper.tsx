import React from "react";
import Legends from "./Legends";
import { LegendWrapperPropsType } from "@/types/app.type";

const LegendWrapper = ({
  title,
  value,
  color,
  unit,
}: LegendWrapperPropsType) => {
  return (
    <Legends
      title={title}
      value={value?.length > 3 ? value.slice(0, 3) : value}
      color={color}
      unit={unit}
      valueTooltip={value?.length > 3 ? value.concat(" ", unit) : ""}
    />
  );
};

export default LegendWrapper;
