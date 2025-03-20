import { useLazyRefetchConfigExportPathsQuery } from "@api/configApi";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import ReFreshExportPathsTime from "@modules/storage-servers/file-server/file-server-overview/components/ReFreshExportPathsTime";
import { EXPORT_PATHS_TABLE_COLS_DEF } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { ExportPathsTablePropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import { Button } from "@netapp/bxp-design-system-react";
import { useState } from "react";

const ExportPathsTable = ({
  fileServerDetails,
  allExportPaths,
  showRefetch,
  isRowSelectingEnabled = false,
  setSelectedExportPathsIds,
}: ExportPathsTablePropsType) => {
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
    setDisableRefresh(true);
    try {
      await reFetchExportPathsApi({
        fileServerId: fileServerDetails.id,
      }).unwrap();
      notify.success("Please wait, the paths will be refreshed soon.");
    } catch (error) {
      notify.error("Something Went Wrong.");
    } finally {
      setDisableRefresh(false);
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
