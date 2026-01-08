import { useState, useEffect, useMemo, useCallback } from "react";
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

// Pagination is based on top-level entries (parents + regular servers)
// Each page shows 10 top-level entries, but expanded children appear inline
const BASE_PAGE_SIZE = 10;

const FileServer = () => {
  const LOWER_TIME_INTERVAL_FOR_IN_PROGRESS = 5000; // 5 seconds
  const navigate = useNavigate();
  const projectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );

  const [isFrequentInterval, setIsFrequentInterval] = useState<boolean>(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

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

  const topLevelEntries = useMemo(() => {
    const serverList = configByProject?.serverConfig || [];
    const { parents, regularServers } = groupDellIsilonFileServers(serverList);
    
    // Mark parents with _isParent flag
    const parentsWithFlag = parents.map(p => ({ ...p, _isParent: true }));
    
    // Combine all entries and sort by createdAt descending (newest first)
    // This ensures Dell Isilon and Other NAS are interleaved based on creation order
    const allEntries = [...parentsWithFlag, ...regularServers];
    
    allEntries.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
    
    return allEntries;
  }, [configByProject?.serverConfig]);

  // Calculate pagination based on top-level entries
  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil(topLevelEntries.length / BASE_PAGE_SIZE));
  }, [topLevelEntries.length]);

  // Get top-level entries for current page
  const currentPageTopLevelEntries = useMemo(() => {
    const startIdx = currentPageIndex * BASE_PAGE_SIZE;
    const endIdx = startIdx + BASE_PAGE_SIZE;
    return topLevelEntries.slice(startIdx, endIdx);
  }, [topLevelEntries, currentPageIndex]);


  const displayRows = useMemo(() => {
    const rows: any[] = [];
    
    for (const entry of currentPageTopLevelEntries) {
      if (entry._isParent) {
        // This is a Dell Isilon parent
        const parent = entry;
        const isExpanded = expandedParents.has(parent.configName);
        const parentSortKey = new Date(parent.createdAt || 0).getTime();
        
        rows.push({
          ...parent,
          id: `dell-parent-${parent.configName}`,
          _isDellIsilonParent: true,
          _isExpanded: isExpanded,
          _zoneCount: parent.zones.length,
          _serverCount: parent.zoneServerCount,
          _sortKey: parentSortKey,
          displayName: `${parent.configName} (${parent.zones.length} zone${parent.zones.length !== 1 ? 's' : ''})`,
        });
        
        // If expanded, add zone file servers as indented child rows (same page)
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
                _sortKey: parentSortKey - childOffset,
                displayName: `${zone.zoneName} (${protocol})`,
              });
              childOffset++;
            }
          }
        }
      } else {
        // Regular file server
        rows.push(entry);
      }
    }
    
    return rows;
  }, [currentPageTopLevelEntries, expandedParents]);

  // Reset page index when data changes and current page is out of bounds
  useEffect(() => {
    if (currentPageIndex >= pageCount) {
      setCurrentPageIndex(Math.max(0, pageCount - 1));
    }
  }, [pageCount, currentPageIndex]);

  // Pagination navigation handler
  const gotoPage = useCallback((pageIndex: number) => {
    if (pageIndex >= 0 && pageIndex < pageCount) {
      setCurrentPageIndex(pageIndex);
    }
  }, [pageCount]);

  const canManageConfig: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageConfig
  );

  const rowMenu = (row: any) => {
    // Dell Isilon parent - expand/collapse and edit options
    if (row._isDellIsilonParent) {
      return [
        {
          label: row._isExpanded ? "Collapse Zones" : "Expand Zones",
          onClick: () => toggleParentExpand(row.configName),
        },
        {
          label: "Edit File Server",
          onClick: () => {
            // Use the original server's id for navigation
            const configId = row._originalServer?.id || row.id?.replace('dell-parent-', '');
            navigate(`/edit-file-server/${configId}`);
          },
          disabled: !canManageConfig,
        },
      ];
    }
    
    // Dell Isilon child (zone file server) - view only, no edit option for zones
    if (row._isDellIsilonChild) {
      // Use _configId (parent config ID) for navigation, not the file server's own id
      const configId = row._configId || row.id;
      // Get the actual file server ID for this zone
      const zoneFileServerId = row.id;
      // Get zone name for query parameter
      const zoneName = row._zoneName || row.displayName || '';
      const zoneParam = encodeURIComponent(zoneName);
      return [
        {
          label: "View File Server",
          onClick: () => {
            navigate(`/file-server/${configId}?zone=${zoneParam}&fileServerId=${zoneFileServerId}`);
          },
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
    // Set page size to show all rows on this page (including expanded children)
    pageSize: displayRows.length > 0 ? displayRows.length : BASE_PAGE_SIZE,
  };

  const customPaginationProps = {
    pageRows: displayRows,                      
    topLevelPageRows: currentPageTopLevelEntries, 
    totalTopLevelRows: topLevelEntries,         
    pageIndex: currentPageIndex,
    pageCount: pageCount,
    gotoPage,
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
      customPagination={customPaginationProps}
    />
  );
};

export default FileServer;
