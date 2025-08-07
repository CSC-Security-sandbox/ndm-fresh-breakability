import { Box } from "@components/container/index";
import { MetricItemAdvance } from "@netapp/bxp-design-system-react";

interface LegendsPropsType {
  title: string;
  value: string | number;
  color?: string;
  unit: string;
  valueTooltip?: string;
}

function getRandomLightColor() {
  const lightColors = [
    "bg-gray-500",
    "bg-gray-600",
    "bg-red-500",
    "bg-red-600",
    "bg-orange-500",
    "bg-orange-600",
    "bg-yellow-500",
    "bg-yellow-600",
    "bg-green-500",
    "bg-green-600",
    "bg-teal-500",
    "bg-teal-600",
    "bg-blue-500",
    "bg-blue-600",
    "bg-indigo-500",
    "bg-indigo-600",
    "bg-purple-500",
    "bg-purple-600",
    "bg-pink-500",
    "bg-pink-600",
  ];

  const randomIndex = Math.floor(Math.random() * lightColors.length);
  return lightColors[randomIndex];
}

const Legends = ({
  title,
  value,
  color,
  unit,
  valueTooltip,
}: LegendsPropsType) => {
  return (
    <Box className="w-5/12 h-1/3 flex items-baseline">
      <Box
        className={`w-6 h-6 rounded-md mx-2 ${color || getRandomLightColor()}`}
      />
      <MetricItemAdvance
        label={title}
        value={value || 0}
        unit={unit || ""}
        valueTooltip={valueTooltip}
      />
    </Box>
  );
};

export default Legends;
