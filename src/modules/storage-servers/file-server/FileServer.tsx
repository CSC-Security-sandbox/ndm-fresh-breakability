import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useGetAllFileServersOfProjectQuery } from "@api/configApi";
import { RootStateType } from "@store/store";
import { Button } from "@netapp/bxp-design-system-react";
import { AddIcon } from "@netapp/bxp-design-system-react/icons/monochrome";
import { useSelector } from "react-redux";
import { FILE_SERVER_LIST_COLUMN_DEFS } from "./file-server.constant";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import PermissionAuth from "@/auth/PermissionAuth";
import { hasPermission } from "@auth/auth.utils";
import { useNavigate } from "react-router-dom";

const FileServer = () => {
  const navigate = useNavigate();
  const projectId = useSelector(
    (state: RootStateType) => state.appSlice.project
  );
  const { data: configByProject, isLoading } =
    useGetAllFileServersOfProjectQuery({
      projectId,
    });

  const canManageJob: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.ManageJob
  );

  const rowMenu = (row: any) => {
    return [
      {
        label: "Edit File Server",
        onClick: () => {
          navigate(`/config/edit-file-server/${row?.id}`);
        },
        disabled: !canManageJob,
      },
    ];
  };

  const ADD_NEW_FILE_SERVER = (
    <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageJob}>
      <Button
        className="ml-4"
        onClick={() => navigate("/config/new-file-server")}
      >
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
    defaultSortState: { sortOrder: "desc", column: 8 },
  };

  return (
    <Box className="w-full p-6">
      <TableWrapper
        tableStateProps={tableStateProps}
        isLoading={isLoading}
        rowMenu={rowMenu}
        content={ADD_NEW_FILE_SERVER}
        label="File Sever List"
      />
    </Box>
  );
};

export default FileServer;
