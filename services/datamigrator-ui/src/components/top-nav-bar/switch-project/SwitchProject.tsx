/* eslint-disable */
import {useDispatch, useSelector} from 'react-redux';
import useAccountDetails from '@/hooks/useAccountDetails';
import useSelectedProjectId from '@hooks/useSelectedProjectId';
import Box from '@/components/container/Box';
import {useGetAllProjectsQuery} from '@api/projectApi';
import {drawerFunctions} from '@components/side-drawer/SideDrawer.utils';
import {Button, Chevron} from '@netapp/bxp-design-system-react';
import {RootStateType} from '@store/store';
import SwitchProjectContent from '@components/top-nav-bar/switch-project/SwitchProjectContent';

const SwitchProject = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const { accountDetails } = useAccountDetails();
  const {data: projectListItems} = useGetAllProjectsQuery(accountDetails?.id);
  const dispatch = useDispatch();
  const drawerProps = useSelector(
    (state: RootStateType) => state?.commonComponentSlice?.drawerProps
  );
  const isActive = drawerProps.isOpen && drawerProps.id === "SwitchProject";

  const { openDrawer } = drawerFunctions(drawerProps, dispatch);
  const projectList = projectListItems || [];
  const selectedProjectName = projectList?.find(
      (row: any) => row.id === selectedProjectId
  )?.project_name;

  const showSwitchProject = () =>
    openDrawer(
      "SwitchProject",
      <SwitchProjectContent
        selectedProjectId={selectedProjectId}
        projectList={projectList}
      />
    );

  return (
    <Button
      onClick={showSwitchProject}
      variant="text"
      className="font-normal text-start gap-4 items-baseline"
    >
      <div className="flex flex-col text-white">
        <div className="font-bold">Project</div>
        <div className="font-normal">{selectedProjectName}</div>
      </div>
      <Box className="custom-chevron">
        <Chevron isActive={isActive} size="sm" />
      </Box>
    </Button>
  );
};

export default SwitchProject;
