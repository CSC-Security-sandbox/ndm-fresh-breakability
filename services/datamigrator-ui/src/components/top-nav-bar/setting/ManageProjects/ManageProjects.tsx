import {Button} from '@netapp/bxp-design-system-react';
import {useState} from 'react';
import Box from '@/components/container/Box';
import TableWrapper from '@components/table-wrapper/TableWrapper';
import {COL_DEF_FOR_PROJECT} from '@/constant/app.constants';
import CreateProjectForm from '@components/top-nav-bar/setting/ManageProjects/CreateProject';
import useAccountDetails from '@/hooks/useAccountDetails';
import {useGetAllProjectsQuery} from '@api/projectApi';
import {USER_PERMISSION_TYPE_ENUM} from '@auth/permissionAuth.constant';
import PermissionAuth from '@/auth/PermissionAuth';
import {Collapse} from '@mui/material';
import {useSelector} from 'react-redux';
import {RootStateType} from '@store/store';
import {USER_ROLES_ENUM} from '@/types/app.type';

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
  const permission = useSelector(
    (state: RootStateType) => state.permissionSlice
  );
  
  const canManageProject = (projectId: string) : boolean => {
    return permission?.userPermissions?.roles?.find(
            (role) => role.projects.includes(projectId) || (role.role_name === USER_ROLES_ENUM.APP_ADMIN && role.projects.length === 0)
          )?.permissions?.includes(USER_PERMISSION_TYPE_ENUM.UpdateProject) ?? false;
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
              permissionName={USER_PERMISSION_TYPE_ENUM.ManageProject}
            >
              <Button onClick={() => setIsCreateFormVisible(true)} className="ml-4">
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
