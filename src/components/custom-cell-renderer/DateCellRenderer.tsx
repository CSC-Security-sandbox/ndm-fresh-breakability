import { format } from "date-fns";
import { Box } from "@/components/container/index";

const DateCellRenderer = ({
  value,
  showSmallerDateFormat = true,
}: {
  value: string;
  showSmallerDateFormat?: boolean;
}) => {
  if (!value) return "";
  value = value.slice(0, -1); // remove timezone from date
  const date = format(value, "dd MMM yyyy");
  const time = format(value, "hh:mm:ss aa");
  const timeSmall = format(value, "hh:mm aa");

  if (showSmallerDateFormat) {
    return (
      <Box className="flex flex-col">
        <Box>{date}</Box>
        <Box>{timeSmall}</Box>
      </Box>
    );
  }

  return (
    <Box className="flex flex-col">
      <Box>{date}</Box>
      <Box>{time} UTC</Box>
    </Box>
  );
};

export default DateCellRenderer;
