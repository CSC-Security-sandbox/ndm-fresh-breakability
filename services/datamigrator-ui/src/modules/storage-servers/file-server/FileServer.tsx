import { useState, useEffect, useMemo } from "react";
import PermissionAuth from "@/auth/PermissionAuth";
import { useGetAllFileServersOfProjectQuery } from "@api/configApi";
import { hasPermission } from "@auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { Button, Text } from "@netapp/bxp-design-system-react";
import { AddIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { ChevronDownMonochromeIcon, ChevronRightMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { RootStateType } from "@store/store";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { FILE_SERVER_LIST_COLUMN_DEFS } from "@modules/storage-servers/file-server/file-server.constant";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { groupDellIsilonFileServers } from "@modules/storage-servers/file-server/components/add-file-server.util";

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

  // Group Dell Isilon file servers by parent and build display rows
  const displayRows = useMemo(() => {
    const serverList = configByProject?.serverConfig || [];
    const { parents, regularServers } = groupDellIsilonFileServers(serverList);
    
    const rows: any[] = [];
    
    // Add Dell Isilon parents with expandable zones
    for (const parent of parents) {
      // Add parent row (expandable header)
      rows.push({
        ...parent,
        id: `dell-parent-${parent.configName}`,
        _isDellIsilonParent: true,
        _isExpanded: expandedParents.has(parent.configName),
        _zoneCount: parent.zones.reduce((acc: number, z: any) => acc + z.fileServers.length, 0),
      });
      
      // If expanded, add zone file servers as indented child rows
      if (expandedParents.has(parent.configName)) {
        for (const zone of parent.zones) {
          for (const fileServer of zone.fileServers) {
            rows.push({
              ...fileServer,
              _isDellIsilonChild: true,
              _parentName: parent.configName,
              _zoneName: zone.zoneName,
              configName: `  └─ ${zone.zoneName} (${fileServer.fileServers?.[0]?.protocol || 'N/A'})`,
            });
          }
        }
      }
    }
    
    // Add regular file servers
    rows.push(...regularServers);
    
    return rows;
  }, [configByProject?.serverConfig, expandedParents]);

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

  const canManageConfig: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageConfig
  );

  const rowMenu = (row: any) => {
    // Dell Isilon parent - no edit option (it's just a container)
    if (row._isDellIsilonParent) {
      return [
        {
          label: row._isExpanded ? "Collapse Zones" : "Expand Zones",
          onClick: () => toggleParentExpand(row.configName),
        },
      ];
    }
    
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
    isSorting: true,
    pageSize: 10,
    defaultSortState: { sortOrder: "desc", column: 9 },
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
