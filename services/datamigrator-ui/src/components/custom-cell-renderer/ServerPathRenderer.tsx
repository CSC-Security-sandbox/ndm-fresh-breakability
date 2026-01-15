import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";

interface ServerPathRendererProps {
  server: string;
  path: string;
  fileServerName?: string;
  serverType?: string;
}

const ServerPathRenderer = ({
  server,
  path,
  fileServerName,
  serverType,
}: ServerPathRendererProps) => {
  // Display serverName:fileServerName only when serverType is not OtherNAS
  const displayServer =
    serverType && serverType !== "OtherNAS" && fileServerName
      ? `${server}:${fileServerName}`
      : server;

  return (
    <Box className="flex flex-col overflow-hidden h-[40px]">
      <Text bold className="overflow-hidden text-ellipsis whitespace-nowrap">
        {displayServer}
      </Text>
      <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
        {path || "-"}
      </Text>
      <Tooltip>
        <Box className="break-words whitespace-pre-wrap">
          <Text bold>{displayServer}</Text>
          <Text>{path || "-"}</Text>
        </Box>
      </Tooltip>
    </Box>
  );
};

export default ServerPathRenderer;
