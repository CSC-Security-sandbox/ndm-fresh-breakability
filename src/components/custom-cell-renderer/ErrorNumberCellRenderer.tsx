import React, { useMemo } from "react";
import { Span } from "@netapp/bxp-design-system-react";
import { ErrorNumberCellRendererProps } from "@/types/app.type";

const ErrorNumberCellRenderer = ({ value }: ErrorNumberCellRendererProps) => {
  const props = value.length > 0 ? { color: "error" } : {};
  const errorCount = useMemo(() => {
    if (!value || value.length === 0) return "-";
    return value.reduce((totalJobRunErrors, error) => totalJobRunErrors + Number(error.count), 0);
  }, [value]);

  return <Span {...props}>{errorCount}</Span>;
};

export default ErrorNumberCellRenderer;