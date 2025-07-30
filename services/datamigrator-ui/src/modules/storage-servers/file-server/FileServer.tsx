import { useState, useEffect } from "react";
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

const FileServer = () => {
  const LOWER_TIME_INTERVAL_FOR_IN_PROGRESS = 5000; // 5 seconds
  const navigate = useNavigate();
  const projectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );

  const [isFrequentInterval, setIsFrequentInterval] = useState<boolean>(false);

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
        (row) => row.status === FILE_SERVER_STATUS_ENUM.IN_PROGRESS
      )
    ) {
      setIsFrequentInterval(true);
    } else {
      setIsFrequentInterval(false);
    }
  }, [configByProject]);

  const canManageConfig: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageConfig
  );

  const rowMenu = (row: any) => {
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
    rows: configByProject?.serverConfig,
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
      label="File Sever List"
      refetchTableData={refetch}
      isRefreshing={isFetching}
    />
  );
};

export default FileServer;
