import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useContext } from "react";
import WorkersWithErrorAccordion from "@modules/storage-servers/file-server/components/steps/ValidateConnection/components/WorkersWithErrorAccordion";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import useSelectedProjectId from "@hooks/useSelectedProjectId";

const ValidateConnection = () => {
  const {
    workersListTableStateProps,
    selectedWorkerIds,
    isFetching,
    refetch,
    selectedProtocol,
    allWorkersList,
  } = useContext(CommonFileServerContext);

  const { selectedProjectId } = useSelectedProjectId();

  const checkDisabled = (row: any) => {
    return row.status !== "Online";
  };

  const getProtocolSpecificLabel = () => {
    const protocolText = selectedProtocol === "NFS" ? "NFS" : "SMB";
    return `${protocolText} Compatible Workers`;
  };

  const getNoWorkersMessage = () => {
    const protocolText = selectedProtocol === "NFS" ? "NFS" : "SMB";
    return (
      <div className="text-center px-2 sm:px-4 py-2 text-xs sm:text-sm md:text-base leading-relaxed break-words">
        <span className="inline-block">
          No {protocolText} compatible workers found. Go to{" "}
          <span className="whitespace-nowrap">View Instructions To Setup Worker</span>{" "}
          to setup a worker and then click the refresh icon to make it available for association.
        </span>
      </div>
    );
  };

  // Render the Worker Installation button for the table header
  const renderWorkerInstallationButton = () => {
    if (allWorkersList.length === 0) {
      return (
        <Box className="flex-shrink-0">
          <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageConfig}>
            <WorkerInstallation
              label="View Instructions To Setup Worker"
              project_id={selectedProjectId}
            />
          </PermissionAuth>
        </Box>
      );
    }
    return null;
  };

  return (
    <Box className="m-auto w-9/12 h-[600px]">
      <WorkersWithErrorAccordion />

      <TableWrapper
        tableStateProps={workersListTableStateProps}
        isRowDisabled={checkDisabled}
        label={getProtocolSpecificLabel()}
        secondaryLabel={`| ${selectedWorkerIds.length} Associated`}
        refetchTableData={refetch}
        isRefreshing={isFetching}
        noDataLabel={
          allWorkersList.length === 0 ? getNoWorkersMessage() : "No Data"
        }
        content={renderWorkerInstallationButton()}
      />
    </Box>
  );
};

export default ValidateConnection;
