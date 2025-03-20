import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import useWorkers from "@hooks/useWorkers";
import { WORKERS_COLUMN_DEF } from "./workers.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { useParams } from "react-router-dom";
import { useGetFileServerWorkersQuery } from "@api/jobsApi";

const Workers = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const { jobRunId } = useParams();
  const { data: workers, isLoading } = useGetFileServerWorkersQuery({
    jobRunId: jobRunId,
  });
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
    />
  );
};

export default Workers;
