import { notify } from "@components/notification/NotificationWrapper";
import { useLazyRefetchConfigExportPathsQuery } from "@api/configApi";
import { Box } from "@components/container/index";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import { Button } from "@netapp/bxp-design-system-react";
import { useState } from "react";
import { EXPORT_PATHS_TABLE_COLS_DEF } from "../fileServerId.constant";
import { ExportPathsTablePropsType } from "../overview.interface";
import ReFreshExportPathsTime from "./ReFreshExportPathsTime";

const ExportPathsTable = ({
  fileServerDetails,
  allExportPaths,
  showRefetch,
  isRowSelectingEnabled = false,
  setSelectedExportPathsIds,
  getFileServerDetails,
}: ExportPathsTablePropsType) => {
  let INTERVAL_ID: any = null;
  const [reFetchExportPathsApi] = useLazyRefetchConfigExportPathsQuery();
  const [disableRefresh, setDisableRefresh] = useState<boolean>(false);

  const tableStateProps = {
    columns: EXPORT_PATHS_TABLE_COLS_DEF,
    rows: allExportPaths,
    isRowSelecting: isRowSelectingEnabled,
    isSorting: true,
    pageSize: 10,
  };

  // REFETCH EXPORT PATHS
  const handleRefetchExportPaths = async () => {
    try {
      setDisableRefresh(true);
      await reFetchExportPathsApi({
        fileServerId: fileServerDetails.id,
      }).unwrap();

      INTERVAL_ID = setInterval(async () => {
        getFileServerDetails().then((resp) => {
          const isAllRefreshed = resp?.fileServers.every(
            ({ isRefreshed }) => isRefreshed
          );

          if (isAllRefreshed) {
            clearInterval(INTERVAL_ID);
            setDisableRefresh(false);
          }
        });
      }, 2000);
    } catch (error) {
      console.error("Error", error);
      notify.error("Something Went Wrong.");
    }
  };

  const FETCHING_DETAILS = (
    <Box className="flex gap-3 justify-end">
      <ReFreshExportPathsTime fileServerDetails={fileServerDetails} />
      <Button
        variant="text"
        onClick={handleRefetchExportPaths}
        disabled={disableRefresh}
      >
        Click here to refresh
      </Button>
    </Box>
  );

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={showRefetch ? FETCHING_DETAILS : ""}
      showLabel={false}
      handleSelection={
        isRowSelectingEnabled ? setSelectedExportPathsIds : undefined
      }
    />
  );
};

export default ExportPathsTable;
