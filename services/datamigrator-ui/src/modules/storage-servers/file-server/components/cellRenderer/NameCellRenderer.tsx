import { BlueXpTableRowType } from "@/types/app.type";
import { Heading, Text } from "@netapp/bxp-design-system-react";
import { useNavigate } from "react-router-dom";
import TooltipRenderer from "@components/custom-cell-renderer/TooltipRenderer";
import { Box } from "@components/container/index";

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

  // Dell Isilon Parent Row - expandable header
  if (row?._isDellIsilonParent) {
    const isExpanded = row._isExpanded;
    const displayName = row.displayName || row.configName;
    
    return (
      <Box className="flex items-center gap-2">
        <Box
          className="cursor-pointer p-1 hover:bg-gray-100 rounded select-none"
          onClick={(e) => {
            e.stopPropagation();
            dellIsilonExpandEvents.emit(row.configName);
          }}
        >
          <Text className="text-sm font-bold">{isExpanded ? "▼" : "▶"}</Text>
        </Box>
        <TooltipRenderer tooltipContent={displayName}>
          <Heading
            level="16"
            color="text-title"
            className="font-bold overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {displayName}
          </Heading>
        </TooltipRenderer>
      </Box>
    );
  }

  // Dell Isilon Child Row (Zone) - indented, clickable to navigate
  if (row?._isDellIsilonChild) {
    const displayName = row.displayName || row.configName;
    
    return (
      <Box className="flex items-center gap-2 pl-6">
        <Text className="text-gray-400">└─</Text>
        <TooltipRenderer tooltipContent={displayName}>
          <Heading
            level="16"
            color="text-title"
            className="cursor-pointer font-bold overflow-hidden text-ellipsis whitespace-nowrap hover:text-blue-600"
            onClick={() => navigate(`/file-server/${row?.id}`)}
          >
            {displayName}
          </Heading>
        </TooltipRenderer>
      </Box>
    );
  }

  // Regular file server row
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