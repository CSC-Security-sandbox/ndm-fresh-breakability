import { Button } from "@netapp/bxp-design-system-react";
import { useState } from "react";
import Box from "@/components/container/Box";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { COL_DEF_FOR_PROJECT } from "@/constant/app.constants";
import CreateProjectForm from "@components/top-nav-bar/setting/ManageProjects/CreateProject";
import useAccountDetails from "@/hooks/useAccountDetails";
import { useGetAllProjectsQuery } from "@api/projectApi";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import PermissionAuth from "@/auth/PermissionAuth";
import { Collapse } from "@mui/material";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";
import { getProjectPermissions } from "@/utils/common.utils";

const ManageProject = () => {
  const [editSelectedProject, setEditSelectedProject] = useState();
  const { accountDetails } = useAccountDetails();
  const {
    data: projectList,
    isLoading,
    isFetching,
    refetch,
  } = useGetAllProjectsQuery(accountDetails?.id);
  const [isCreateFormVisible, setIsCreateFormVisible] =
    useState<boolean>(false);
  const closeAction = () => {
    setEditSelectedProject(undefined);
    setIsCreateFormVisible(false);
  };

  const userPermissions = useSelector(
    (state: RootStateType) => state.permissionSlice?.userPermissions
  );

  const canManageProject = (projectId: string): boolean => {
    return (
      getProjectPermissions(projectId, userPermissions)?.includes(
        USER_PERMISSION_TYPE_ENUM.UpdateProject
      ) ?? false
    );
  };

  const rowMenu = (row) => {
    return [
      {
        label: "Edit Project",
        onClick: () => {
          setEditSelectedProject(row);
          setIsCreateFormVisible(true);
        },
        disabled: !canManageProject(row.id),
      },
    ];
  };

  const tableStateProps = {
    columns: COL_DEF_FOR_PROJECT,
    rows: projectList,
    isSorting: true,
    pageSize: 10,
  };

  return (
    <Box className="ag-theme-alpine p-6 w-full h-[43.75rem]">
      <Collapse in={isCreateFormVisible} mountOnEnter unmountOnExit>
        <CreateProjectForm
          closeAction={closeAction}
          editSelectedProject={editSelectedProject}
        />
      </Collapse>

      <Collapse in={!isCreateFormVisible}>
        <TableWrapper
          tableStateProps={tableStateProps}
          isLoading={isLoading}
          rowMenu={rowMenu}
          label="Projects"
          content={
            <PermissionAuth
              permissionName={USER_PERMISSION_TYPE_ENUM.ManageProject}
            >
              <Button onClick={() => setIsCreateFormVisible(true)}>
                Add Project
              </Button>
            </PermissionAuth>
          }
          originalColumns={COL_DEF_FOR_PROJECT}
          refetchTableData={refetch}
          isRefreshing={isFetching}
        />
      </Collapse>
    </Box>
  );
};

export default ManageProject;
