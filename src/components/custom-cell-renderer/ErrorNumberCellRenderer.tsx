import { Span } from "@netapp/bxp-design-system-react";

const ErrorNumberCellRenderer = ({ value }: { value: number }) => {
  const props = value > 0 ? { color: "error" } : {};
  return <Span {...props}>{value || "-"}</Span>;
};

export default ErrorNumberCellRenderer;
