import { BlueXpTableRowType } from "@/types/app.type";
import { Heading, Text } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Box } from "@components/container/index";
import { ChevronRightIcon, CardArrowExpandIcon } from "@netapp/bxp-style/react-icons/Navigation";

// Event bus for expand/collapse - simple approach to communicate with FileServer.tsx
export const dellIsilonExpandEvents = {
  listeners: new Map<string, (parentName: string) => void>(),
  subscribe(id: string, callback: (parentName: string) => void) {
    this.listeners.set(id, callback);
    return () => this.listeners.delete(id);
  },
  emit(parentName: string) {
    this.listeners.forEach((callback) => callback(parentName));
  },
};

const NameCellRenderer = (params: BlueXpTableRowType<any, any>) => {
  const navigate = useNavigate();
  const row = params?.row;

  // Dell Isilon Parent Row - Accordion header (entire row is clickable)
  if (row?._isDellIsilonParent) {
    const isExpanded = row._isExpanded;
    const parentName = row.configName;
    
    return (
      <Box 
        className="flex items-center gap-3 cursor-pointer py-1 px-2 -ml-2 rounded hover:bg-blue-50 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          dellIsilonExpandEvents.emit(parentName);
        }}
      >
        {/* Expand/Collapse Arrow - BlueXP styled */}
        <Box className="flex items-center justify-center w-5 h-5">
          {isExpanded ? (
            <CardArrowExpandIcon size="16" color="text-action-primary" />
          ) : (
            <ChevronRightIcon size="16" color="text-action-primary" />
          )}
        </Box>
        
        {/* Parent Name */}
        <Heading
          level="16"
          color="text-title"
          className="font-bold overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {parentName}
        </Heading>
      </Box>
    );
  }

  // Dell Isilon Child Row (Zone) - Indented submenu item style
  if (row?._isDellIsilonChild) {
    const zoneName = row._zoneName || row.displayName;
    
    return (
      <Box 
        className="flex items-center gap-2 pl-8 py-1 cursor-pointer hover:bg-blue-50 rounded transition-colors -ml-2 px-2"
        onClick={() => navigate(`/file-server/${row?.id}`)}
      >
        {/* Indentation line */}
        <Box className="flex items-center text-gray-300">
          
        </Box>
        
        {/* Zone name only */}
        <Heading
          level="16"
          color="text-title"
          className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap hover:text-blue-600"
        >
          {zoneName}
        </Heading>
      </Box>
    );
  }

  // Regular file server row (non-Dell Isilon)
  return (
    <TooltipRenderer tooltipContent={row?.configName}>
      <Heading
        level="16"
        color="text-title"
        className="cursor-pointer font-bold overflow-hidden text-ellipsis whitespace-nowrap"
        onClick={() => navigate(`/file-server/${row?.id}`)}
      >
        {row?.configName}
      </Heading>
    </TooltipRenderer>
  );
};

export default NameCellRenderer;