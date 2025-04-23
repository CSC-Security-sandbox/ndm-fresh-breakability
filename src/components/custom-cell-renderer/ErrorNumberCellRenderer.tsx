import React, { useMemo } from "react";
import { Span } from "@netapp/bxp-design-system-react";
import { ErrorNumberCellRendererProps } from "@/types/app.type";

const ErrorNumberCellRenderer = ({ value }: ErrorNumberCellRendererProps) => {
  const props = value.length > 0 ? { color: "error" } : {};

  const getErrorCount = () => {
    if (value.length === 0) {
      return "-";
    } else {
      return value.reduce((totalJobRunErrors, error) => totalJobRunErrors + Number(error.count), 0);
    }
  };
  const errorCount = useMemo(() => getErrorCount(), [value]);

  return <Span {...props}>{errorCount}</Span>;
};

export default ErrorNumberCellRenderer;