import { useState } from "react";
import { TableRendererPropsType } from "../overview.interface";
import ExportPathsTable from "./ExportPathsTable";
import OverviewTabs from "./OverviewTabs";
import WorkersTable from "./WorkersTable";

const TableRenderer = ({
  fileServerDetails,
  getFileServerDetails,
  allExportPaths,
  allWorkersList,
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
          getFileServerDetails={getFileServerDetails}
          fileServerDetails={fileServerDetails}
          showRefetch={true}
          setSelectedExportPathsIds={() => {}}
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
