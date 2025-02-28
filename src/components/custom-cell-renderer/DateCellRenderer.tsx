import { format } from "date-fns";
import { Box } from "@/components/container/index";

const DateCellRenderer = ({ value }: { value: string }) => {
  if (!value) return "";
  value = value.slice(0, -1); // remove timezone from date
  const date = format(value, "dd MMM yyyy");
  const time = format(value, "hh:mm:ss aa");
  return (
    <Box className="flex flex-col">
      <Box>{date}</Box>
      <Box>{time} UTC</Box>
    </Box>
  );
};

export default DateCellRenderer;
