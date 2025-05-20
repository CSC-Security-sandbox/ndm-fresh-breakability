import Box from "@/components/container/Box";

const StatusCellRenderer = ({
  status,
  active,
}: {
  status: string;
  active: boolean;
}) => {
  const style = active ? "bg-notification-success" : "bg-red-500";
  return (
    <Box className="flex gap-2 items-center">
      <span className={`w-3 h-3 rounded-full inline-block ${style}`}></span>
      <Box className="capitalize">{status.toLowerCase()}</Box>
    </Box>
  );
};

export default StatusCellRenderer;
