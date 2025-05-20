import TableWrapper from "@components/table-wrapper/TableWrapper";
import { WORKERS_PATHS_TABLE_COLS_DEF } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { WorkersTablePropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";

const WorkersTable = ({ allWorkersList }: WorkersTablePropsType) => {
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
