import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import useFetchWorkers from "@hooks/useFetchWorkers";
import { WORKERS_COLUMN_DEF } from "@modules/workers/workers.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { notify } from "@components/notification/NotificationWrapper";

const Workers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const { workers, error, isLoading, isFetching, refetch } = useFetchWorkers();

  const tableStateProps = {
    columns: WORKERS_COLUMN_DEF,
    rows: workers,
    isSorting: true,
    pageSize: 10,
  };

  if (error) {
    notify.error("Failed to fetch workers.");
    console.error({ error, level: "workers" });
  }

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={
        <PermissionAuth
          permissionName={USER_PERMISSION_TYPE_ENUM.WorkerDeployment}
        >
          <WorkerInstallation
            label="View Instruction To Setup Worker"
            project_id={selectedProjectId}
          />
        </PermissionAuth>
      }
      isLoading={isLoading}
      label="Workers"
      refetchTableData={refetch}
      isRefreshing={isFetching}
    />
  );
};

export default Workers;
