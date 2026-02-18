import { Box } from "@components/container/index";
import { Text, Tooltip } from "@netapp/bxp-design-system-react";

const DetailTile = ({ title, value }: { title: string; value: string }) => {
  return (
    <Box className="flex flex-col gap-4">
      <Text bold>{title}</Text>
      <Text className="truncate">{value}</Text>
      <Tooltip>
        <Box className="break-all whitespace-pre-wrap">
          <Text>{value}</Text>
        </Box>
      </Tooltip>
    </Box>
  );
};

export default DetailTile;
