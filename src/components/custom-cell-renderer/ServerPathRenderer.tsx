import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";

const ServerPathRenderer = ({
  server,
  path,
}: {
  server: string;
  path: string;
}) => (
  <Box className="flex flex-col overflow-hidden">
    <Text bold>{server}</Text>
    <Text>{path || "-"}</Text>
    <Tooltip>
      <Box className="flex flex-col">
        <Text bold>{server}</Text>
        <Text>{path || "-"}</Text>
      </Box>
    </Tooltip>
  </Box>
);

export default ServerPathRenderer;
