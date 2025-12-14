import { useState, useEffect, useMemo } from "react";
import PermissionAuth from "@/auth/PermissionAuth";
import { useGetAllFileServersOfProjectQuery } from "@api/configApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { Button } from "@netapp/bxp-design-system-react";
import { AddIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { RootStateType } from "@store/store";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FILE_SERVER_LIST_COLUMN_DEFS } from "@modules/storage-servers/file-server/file-server.constant";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { groupDellIsilonFileServers } from "@modules/storage-servers/file-server/components/add-file-server.util";
import { dellIsilonExpandEvents } from "@modules/storage-servers/file-server/components/cellRenderer/NameCellRenderer";

const FileServer = () => {
  const LOWER_TIME_INTERVAL_FOR_IN_PROGRESS = 5000; // 5 seconds
  const navigate = useNavigate();
  const projectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );

  const [isFrequentInterval, setIsFrequentInterval] = useState<boolean>(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  const {
    data: configByProject,
    isLoading,
    isFetching,
    refetch,
  } = useGetAllFileServersOfProjectQuery(
    {
      projectId,
    },
    {
      pollingInterval: isFrequentInterval
        ? LOWER_TIME_INTERVAL_FOR_IN_PROGRESS
        : Number(
            window?.env?.VITE_TIME_INTERVAL ||
              import.meta.env.VITE_TIME_INTERVAL
          ),
    }
  );

  useEffect(() => {
    if (
      configByProject?.serverConfig?.find(
        (row: any) => row.status === FILE_SERVER_STATUS_ENUM.IN_PROGRESS
      )
    ) {
      setIsFrequentInterval(true);
    } else {
      setIsFrequentInterval(false);
    }
  }, [configByProject]);

  // Subscribe to Dell Isilon expand/collapse events from NameCellRenderer
  useEffect(() => {
    const unsubscribe = dellIsilonExpandEvents.subscribe('fileServerList', (parentName: string) => {
      toggleParentExpand(parentName);
    });
    return unsubscribe;
  }, []);

  const toggleParentExpand = (parentName: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentName)) {
        next.delete(parentName);
      } else {
        next.add(parentName);
      }
      return next;
    });
  };

  // Group Dell Isilon file servers by parent and build display rows
  const displayRows = useMemo(() => {
    const serverList = configByProject?.serverConfig || [];
    const { parents, regularServers } = groupDellIsilonFileServers(serverList);
    
    const rows: any[] = [];
    
    // Sort parents by createdAt descending (newest first)
    const sortedParents = [...parents].sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });
    
    // Add Dell Isilon parents with expandable zones
    for (const parent of sortedParents) {
      // Add parent row (expandable header)
      const isExpanded = expandedParents.has(parent.configName);
      
      // Create a sort key that keeps children grouped with parent
      // Parent gets base timestamp, children get same timestamp + small offset
      const parentSortKey = new Date(parent.createdAt || 0).getTime();
      
      rows.push({
        ...parent,
        id: `dell-parent-${parent.configName}`,
        _isDellIsilonParent: true,
        _isExpanded: isExpanded,
        _zoneCount: parent.zones.length,
        _serverCount: parent.zoneServerCount,
        _sortKey: parentSortKey,
        // Show zone count in the name for parent rows
        displayName: `${parent.configName} (${parent.zones.length} zone${parent.zones.length !== 1 ? 's' : ''})`,
      });
      
      // If expanded, add zone file servers as indented child rows
      if (isExpanded) {
        let childOffset = 1;
        for (const zone of parent.zones) {
          for (const fileServer of zone.fileServers) {
            const protocol = fileServer._protocol || fileServer.fileServers?.[0]?.protocol || 'N/A';
            rows.push({
              ...fileServer,
              _isDellIsilonChild: true,
              _parentName: parent.configName,
              _zoneName: zone.zoneName,
              _sortKey: parentSortKey - childOffset, // Slightly less than parent to keep order
              // Display indented zone name with protocol
              displayName: `${zone.zoneName} (${protocol})`,
            });
            childOffset++;
          }
        }
      }
    }
    
    // Sort regular servers by createdAt descending and add them
    const sortedRegularServers = [...regularServers].sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });
    
    rows.push(...sortedRegularServers);
    
    return rows;
  }, [configByProject?.serverConfig, expandedParents]);

  const canManageConfig: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageConfig
  );

  const rowMenu = (row: any) => {
    // Dell Isilon parent - expand/collapse option only
    if (row._isDellIsilonParent) {
      return [
        {
          label: row._isExpanded ? "Collapse Zones" : "Expand Zones",
          onClick: () => toggleParentExpand(row.configName),
        },
      ];
    }
    
    // Dell Isilon child (zone file server) - view/edit options
    if (row._isDellIsilonChild) {
      return [
        {
          label: "View File Server",
          onClick: () => {
            navigate(`/file-server/${row?.id}`);
          },
        },
        {
          label: "Edit File Server",
          onClick: () => {
            navigate(`/edit-file-server/${row?.id}`);
          },
          disabled: !canManageConfig,
        },
      ];
    }
    
    // Regular file server
    return [
      {
        label: "Edit File Server",
        onClick: () => {
          navigate(`/edit-file-server/${row?.id}`);
        },
        disabled: !canManageConfig,
      },
    ];
  };

  const ADD_NEW_FILE_SERVER = (
    <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageConfig}>
      <Button onClick={() => navigate("/new-file-server")}>
        <Box className="flex items-stretch">
          <AddIcon fontSize="small" size="20" />
          Add
        </Box>
      </Button>
    </PermissionAuth>
  );

  const tableStateProps = {
    columns: FILE_SERVER_LIST_COLUMN_DEFS,
    rows: displayRows,
    // Disable table sorting - we handle sorting manually to preserve parent-child order
    isSorting: false,
    pageSize: 10,
  };

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      isLoading={isLoading}
      rowMenu={rowMenu}
      content={ADD_NEW_FILE_SERVER}
      label="File Server List"
      refetchTableData={refetch}
      isRefreshing={isFetching}
    />
  );
};

export default FileServer;
