import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";

const ServerPathRenderer = ({
  server,
  path,
}: {
  server: string;
  path: string;
}) => (
  <Box className="flex flex-col overflow-hidden h-[40px]">
    <Text bold className="overflow-hidden text-ellipsis whitespace-nowrap">{server}</Text>
    <Text className="overflow-hidden text-ellipsis whitespace-nowrap">{path || "-"}</Text>
    <Tooltip>
      <Box className="flex flex-col">
        <Text bold>{server}</Text>
        <Text>{path || "-"}</Text>
      </Box>
    </Tooltip>
  </Box>
);

export default ServerPathRenderer;
