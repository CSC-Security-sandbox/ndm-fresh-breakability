import { Text, Tooltip } from "@netapp/bxp-design-system-react";
import Box from "@/components/container/Box";
import { JOBS_TYPE } from "@/types/app.type";

interface ServerPathRendererProps {
  server: string;
  path: string;
  directoryPath?: string;
  fileServerName: string;
  serverType: string;
  jobType?: JOBS_TYPE;
}

const ServerPathRenderer = ({
  server,
  path,
  directoryPath,
  fileServerName,
  serverType,
  jobType,
}: ServerPathRendererProps) => {
  // Display serverName:fileServerName only when serverType is not OtherNAS
  const displayServer =
    serverType && serverType !== "OtherNAS" && fileServerName
      ? `${server}:${fileServerName}`
      : server;

  return (
    <Box className="flex flex-col overflow-hidden justify-center">
      <Text bold className="overflow-hidden text-ellipsis whitespace-nowrap">
        {displayServer}
      </Text>
      <Text className="overflow-hidden text-ellipsis whitespace-nowrap">
        {`${path || "-"}${directoryPath || ""}`}  
      </Text>
      <Tooltip>
        <Box className="break-all whitespace-pre-wrap">
          <Text bold>{displayServer}</Text>
          <Text>{`${path || "-"}${directoryPath || ""}`}</Text>
        </Box>
      </Tooltip>
    </Box>
  );
};

export default ServerPathRenderer;
