import TableWrapper from "@components/table-wrapper/TableWrapper";
import { useEffect } from "react";
import { WORKERS_PATHS_TABLE_COLS_DEF } from "../fileServerId.constant";
import { WorkersTablePropsType } from "../overview.interface";

const WorkersTable = ({
  fileServerDetails,
  allWorkersList,
}: WorkersTablePropsType) => {
  useEffect(() => {
    if (fileServerDetails?.fileServers) {
    }
  }, [fileServerDetails]);

  const tableStateProps = {
    columns: WORKERS_PATHS_TABLE_COLS_DEF,
    rows: allWorkersList,
    isSorting: true,
    pageSize: 10,
  };

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={<></>}
      label="Workers"
    />
  );
};

export default WorkersTable;
