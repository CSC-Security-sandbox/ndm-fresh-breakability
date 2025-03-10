import { format } from "date-fns";
import { Box } from "@components/container";
import { memo } from "react";

const SpeedDetailsCellRenderer = ({ value }: { value: string }) => {
  if (!value) return "";
  value = value.slice(0, -1); // remove timezone from date
  const date = format(value, "dd MMM yyyy");
  const time = format(value, "hh:mm:ss aa");
  return (
    <Box>
      {date}
      {time} UTC
    </Box>
  );
};

export default memo(SpeedDetailsCellRenderer);
