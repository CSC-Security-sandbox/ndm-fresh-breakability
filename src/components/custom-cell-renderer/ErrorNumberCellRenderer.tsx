import { Span } from "@netapp/bxp-design-system-react";

const ErrorNumberCellRenderer = ({ value }: { value: { errortype: string, count: string}[] }) => {
  const props = value.length > 0 ? { color: "error" } : {};
  const errorCount = value.length > 0 ? value.reduce((totalJobRunErrors, error) => totalJobRunErrors + Number(error.count), 0) : "-";

  return <Span {...props}>{errorCount}</Span>;
};

export default ErrorNumberCellRenderer;
