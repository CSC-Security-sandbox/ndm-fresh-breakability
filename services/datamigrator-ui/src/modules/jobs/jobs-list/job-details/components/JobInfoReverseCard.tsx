import { Box } from "@components/container/index";
import { JobInfoReverseCardPropType } from "@/types/app.type";
import { Text, Heading } from "@netapp/bxp-design-system-react";

const JobInfoReverseCard = (props: JobInfoReverseCardPropType) => {
  const { label, value, valueType } = props;
  return (
    <Box className="flex flex-col grow">
      <Box className="flex gap-1 items-baseline">
        <Heading level="24">{value}</Heading>
        {valueType && <Text>{valueType}</Text>}
      </Box>
      <Text>{label}</Text>
    </Box>
  );
};

export default JobInfoReverseCard;
