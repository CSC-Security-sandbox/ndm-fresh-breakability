import { Box } from "@components/container/index";
import { Tooltip } from "@netapp/bxp-design-system-react";

const PreCheckPathInfo = ({
  label,
  truncatedPath,
  fullPath,
  destination = "",
}) => (
  <>
    <Box>
      {label}: {truncatedPath || "N/A"}
      {destination && ` (${destination})`}
    </Box>
    {fullPath && <Tooltip>{fullPath}</Tooltip>}
  </>
);

export default PreCheckPathInfo;
