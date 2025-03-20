import TableWrapper from "@components/table-wrapper/TableWrapper";
import { WORKERS_PATHS_TABLE_COLS_DEF } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { WorkersTablePropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import { useEffect } from "react";
import RefreshTableData from "@components/table-wrapper/RefreshTableData";
import { useDispatch } from "react-redux";
import { configApi } from "@api/configApi";

const WorkersTable = ({
  fileServerDetails,
  allWorkersList,
  isFetching,
}: WorkersTablePropsType) => {

  const dispatch = useDispatch();
  
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

  const refreshWorkersPathsList = () => {
    const { recallApiData } = RefreshTableData(dispatch);
    // recallApiData({api: configApi, tag: 'GET_FILE_SERVER_BY_ID'});
  }

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={<></>}
      label="Workers"
      refreshFunc={refreshWorkersPathsList}
      isRefreshing={isFetching}
    />
  );
};

export default WorkersTable;
