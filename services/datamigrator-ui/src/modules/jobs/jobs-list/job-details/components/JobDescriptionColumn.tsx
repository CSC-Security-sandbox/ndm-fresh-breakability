import { Box } from "@components/container/index";
import { JobDescriptionColumnPropType } from "@/types/app.type";
import { Text } from "@netapp/bxp-design-system-react";

const JobDescriptionColumn = ({
  name,
  value,
}: JobDescriptionColumnPropType) => (
  <Box className="flex flex-col gap-0">
    <Text bold>{name}</Text>
    <Text>{value}</Text>
  </Box>
);

export default JobDescriptionColumn;
