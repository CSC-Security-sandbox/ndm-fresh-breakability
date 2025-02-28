import { Text } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";

const ServerPathRenderer = ({
  server,
  path,
}: {
  server: string;
  path: string;
}) => (
  <Box className="flex flex-col">
    <Text bold>{server}</Text>
    <Text>{path || "-"}</Text>
  </Box>
);

export default ServerPathRenderer;
