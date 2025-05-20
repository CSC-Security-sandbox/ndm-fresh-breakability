import { Box } from "@components/container/index";
import { Text } from "@netapp/bxp-design-system-react";

const DetailTile = ({ title, value }: { title: string; value: string }) => {
  return (
    <Box className="flex flex-col gap-4">
      <Text>{title}</Text>
      <Text bold>{value}</Text>
    </Box>
  );
};

export default DetailTile;
