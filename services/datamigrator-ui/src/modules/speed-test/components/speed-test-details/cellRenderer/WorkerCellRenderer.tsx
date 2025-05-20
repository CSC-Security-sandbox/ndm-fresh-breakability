import { Popover } from "@netapp/bxp-design-system-react";

const WorkerCellRenderer = ({ value }: any) => {
  if (value === "-") return value;

  if (!isNaN(Number(value))) return `${value} Mbps`;

  return <Popover Trigger="error">{value}</Popover>;
};

export default WorkerCellRenderer;
