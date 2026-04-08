import { Box } from "@components/container/index";
import { JobInfoReverseCardPropType } from "@/types/app.type";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Text, Heading } from "@netapp/bxp-design-system-react";

const JobInfoReverseCard = (props: JobInfoReverseCardPropType) => {
  const { label, value, valueType, labelTooltip } = props;
  const labelNode = labelTooltip ? (
    <TooltipRenderer tooltipContent={labelTooltip}>
      <Text className="cursor-default underline decoration-dotted underline-offset-2">
        {label}
      </Text>
    </TooltipRenderer>
  ) : (
    <Text>{label}</Text>
  );
  return (
    <Box className="flex flex-col grow">
      <Box className="flex gap-1 items-baseline">
        <Heading level="24">{value}</Heading>
        {valueType && <Text>{valueType}</Text>}
      </Box>
      {labelNode}
    </Box>
  );
};

export default JobInfoReverseCard;
