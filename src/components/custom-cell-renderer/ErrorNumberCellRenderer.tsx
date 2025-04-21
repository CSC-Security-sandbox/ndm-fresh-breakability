import { Span } from "@netapp/bxp-design-system-react";

interface errors {
  errortype: string;
  count: string;
}

const ErrorNumberCellRenderer = ({ value }: { value: errors[] }) => {
  const props = value.length > 0 ? { color: "error" } : {};
  const errorCount = value.length > 0 ? value.reduce((acc, error) => acc + Number(error.count), 0) : "-";

  return <Span {...props}>{errorCount}</Span>;
};

export default ErrorNumberCellRenderer;
