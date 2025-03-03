"use client";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import useWorkers from "@hooks/useWorkers";
import WorkerInstallationContent from "@components/top-nav-bar/setting/ManageProjects/WorkerInstallationContent";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import PermissionAuth from "@/auth/PermissionAuth";
import { WORKERS_COLUMN_DEF } from "./workers.constant";

const Workers = () => {
  const { workers, isLoading } = useWorkers();
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
          <WorkerInstallationContent />
        </PermissionAuth>
      }
      isLoading={isLoading}
      label="Workers"
    />
  );
};

export default Workers;
