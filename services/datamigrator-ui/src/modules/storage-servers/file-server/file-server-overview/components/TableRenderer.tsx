import { useState } from "react";
import { TableRendererPropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import ExportPathsTable from "@modules/storage-servers/file-server/file-server-overview/components/ExportPathsTable";
import OverviewTabs from "@modules/storage-servers/file-server/file-server-overview/components/OverviewTabs";
import WorkersTable from "@modules/storage-servers/file-server/file-server-overview/components/WorkersTable";

const TableRenderer = ({
  fileServerDetails,
  allExportPaths,
  allWorkersList,
  refetch,
  isFetching,
}: TableRendererPropsType) => {
  const [currentTab, setCurrentTab] = useState<number>(1);
  return (
    <>
      <OverviewTabs
        fileServerDetails={fileServerDetails}
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        allExportPaths={allExportPaths}
        allWorkersList={allWorkersList}
      />

      {currentTab === 1 ? (
        <ExportPathsTable
          allExportPaths={allExportPaths}
          fileServerDetails={fileServerDetails}
          showRefetch={true}
          setSelectedExportPathsIds={() => {}}
          refetch={refetch}
          isFetching={isFetching}
        />
      ) : (
        <WorkersTable
          fileServerDetails={fileServerDetails}
          allWorkersList={allWorkersList}
          showRefetch={false}
        />
      )}
    </>
  );
};

export default TableRenderer;
