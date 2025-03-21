import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import useWorkers from "@hooks/useWorkers";
import { WORKERS_COLUMN_DEF } from "./workers.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";

const Workers = () => {
  const { workers, isLoading, isFetching, refetch } = useWorkers();
  const { selectedProjectId } = useSelectedProjectId();
  const tableStateProps = {
    columns: WORKERS_COLUMN_DEF,
    rows: workers,
    isSorting: true,
    pageSize: 10,
  };

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={
        <PermissionAuth
          permissionName={USER_PERMISSION_TYPE_ENUM.AgentDeployment}
        >
          <WorkerInstallation
            label="View Instruction To Setup Worker"
            project_id={selectedProjectId}
          />
        </PermissionAuth>
      }
      isLoading={isLoading}
      label="Workers"
      refreshFunc={refetch}
      isRefreshing={isFetching}
    />
  );
};

export default Workers;
