import { Button } from "@netapp/bxp-design-system-react";
import { useState } from "react";
import Box from "@/components/container/Box";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { COL_DEF_FOR_PROJECT } from "@/constant/app.constants";
import CreateProjectForm from "@components/top-nav-bar/setting/ManageProjects/CreateProject";
import useAccountDetails from "@/hooks/useAccountDetails";
import { useGetAllProjectsQuery } from "@api/projectApi";
import { hasPermission } from "@/auth/auth.utils";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import PermissionAuth from "@/auth/PermissionAuth";
import { Collapse } from "@mui/material";

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

  const canManageProject: boolean = hasPermission(
    USER_PERMISSION_TYPE_ENUM.UpdateProject
  );

  const rowMenu = (row) => {
    return [
      {
        label: "Edit Project",
        onClick: () => {
          setEditSelectedProject(row);
          setIsCreateFormVisible(true);
        },
        disabled: !canManageProject,
      },
    ];
  };

  const tableStateProps = {
    columns: COL_DEF_FOR_PROJECT,
    rows: projectList?.data?.items,
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
              permissionName={USER_PERMISSION_TYPE_ENUM.DeleteProject}
            >
              <Button
                onClick={() => setIsCreateFormVisible(true)}
                className="ml-4"
              >
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
