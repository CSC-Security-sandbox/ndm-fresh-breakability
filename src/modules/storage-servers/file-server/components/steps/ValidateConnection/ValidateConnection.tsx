import { CommonFileServerContext } from "@modules/storage-servers/file-server/context/CommonFileServerContextProvider";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useContext } from "react";
import WorkersWithErrorAccordion from "./components/WorkersWithErrorAccordion";

const ValidateConnection = () => {
  const { workersListTableStateProps, selectedWorkerIds, isFetching, refetch } = useContext(
    CommonFileServerContext
  );

  const checkDisabled = (row: any) => {
    return row.status !== "Online";
  };

  return (
    <Box className="m-auto w-9/12 h-[600px]">
      <WorkersWithErrorAccordion />
      <TableWrapper
        tableStateProps={workersListTableStateProps}
        isRowDisabled={checkDisabled}
        label="Workers"
        secondaryLabel={`| ${selectedWorkerIds.length} Associated`}
        refetchTableData={refetch}
        isRefreshing={isFetching}
      />
    </Box>
  );
};

export default ValidateConnection;
