import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Text } from "@netapp/bxp-design-system-react";

export interface TruncatedPathCellProps {
  value: string;
  /** Optional; when omitted, truncation is purely CSS-based (by available width, adjusts with zoom/column width) */
  maxLength?: number;
}

/**
 * Renders a path value. Text truncates by available cell width (CSS ellipsis),
 * so visible length adjusts with zoom and column size. Full value is shown in tooltip on hover.
 */
const TruncatedPathCell = ({ value }: TruncatedPathCellProps) => {
  const display = value || "-";

  return (
    <TooltipRenderer tooltipContent={display} show={!!display}>
      <Text className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {display}
      </Text>
    </TooltipRenderer>
  );
};

export default TruncatedPathCell;