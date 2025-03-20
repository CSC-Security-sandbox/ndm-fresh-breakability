import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useContext } from "react";
import WorkersWithErrorAccordion from "./components/WorkersWithErrorAccordion";
import useRTKApiRefresh from "@hooks/useRTKApiRefresh";
import { workersApi } from "@api/workersApi";

const ValidateConnection = () => {
  const { workersListTableStateProps, selectedWorkerIds, isFetching } = useContext(
    CommonFileServerContext
  );

  const checkDisabled = (row: any) => {
    return row.status !== "Online";
  };

  const refreshWorkersList = useRTKApiRefresh({ api: workersApi, tag: "GET_ALL_WORKERS" });

  return (
    <Box className="m-auto w-9/12 h-[600px]">
      <WorkersWithErrorAccordion />
      <TableWrapper
        tableStateProps={workersListTableStateProps}
        isRowDisabled={checkDisabled}
        label="Workers"
        secondaryLabel={`| ${selectedWorkerIds.length} Associated`}
        refreshFunc={refreshWorkersList}
        isRefreshing={isFetching}
      />
    </Box>
  );
};

export default ValidateConnection;
