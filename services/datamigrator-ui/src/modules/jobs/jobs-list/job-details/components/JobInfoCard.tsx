import { Box } from "@components/container/index";
import { Text, Heading } from "@netapp/bxp-design-system-react";
import { JobInfoCardPropType } from "@/types/app.type";

const JobInfoCard = (props: JobInfoCardPropType) => {
  const { label, value } = props;
  return (
    <Box className="flex flex-col grow">
      <Heading level="24">{label}</Heading>
      {typeof value === "string" ? <Text>{value}</Text> : value}
    </Box>
  );
};

export default JobInfoCard;
