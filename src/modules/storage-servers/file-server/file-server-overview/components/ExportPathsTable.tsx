import {
  configApi,
  useLazyRefetchConfigExportPathsQuery,
} from "@api/configApi";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import ReFreshExportPathsTime from "@modules/storage-servers/file-server/file-server-overview/components/ReFreshExportPathsTime";
import { EXPORT_PATHS_TABLE_COLS_DEF } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { ExportPathsTablePropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import { Button } from "@netapp/bxp-design-system-react";
import { useEffect, useRef, useState } from "react";
import { useLazyCheckConnectionRespQuery } from "@api/workerManagerApi";
import { ValidateConnectionStatus } from "@/types/app.type";
import { useDispatch } from "react-redux";
import { MAX_RETRY_API_ATTEMPTS } from "@/utils/constants";

const ExportPathsTable = ({
  fileServerDetails,
  allExportPaths,
  showRefetch,
  isRowSelectingEnabled = false,
  setSelectedExportPathsIds,
}: ExportPathsTablePropsType) => {
  const interval = useRef<any | undefined>("");
  const [reFetchExportPathsApi] = useLazyRefetchConfigExportPathsQuery();
  const [disableRefresh, setDisableRefresh] = useState<boolean>(false);
  const [getWorkFlowStatus] = useLazyCheckConnectionRespQuery();
  const dispatch = useDispatch();

  const tableStateProps = {
    columns: EXPORT_PATHS_TABLE_COLS_DEF,
    rows: allExportPaths,
    isRowSelecting: isRowSelectingEnabled,
    isSorting: true,
    pageSize: 10,
  };

  const showErrorOnRefetchFailure = (error: Error) => {
    setDisableRefresh(false);
    interval.current && clearInterval(interval.current);

    notify.error(
      `Failed to refresh the list, reason - ${error?.message || "unknown"}`
    );
    console.error({ level: "File server overview - refresh list.", error });
  };

  // REFETCH EXPORT PATHS
  const handleRefetchExportPaths = async () => {
    setDisableRefresh(true);
    try {
      let retryCount = 0;
      const response = await reFetchExportPathsApi({
        fileServerId: fileServerDetails.id,
      }).unwrap();

      interval.current = setInterval(async () => {
        if (retryCount++ === MAX_RETRY_API_ATTEMPTS) {
          const error = new Error(
            `Request timed out after ${MAX_RETRY_API_ATTEMPTS} attempts`
          );
          showErrorOnRefetchFailure(error);
        }

        const data = await getWorkFlowStatus({
          id: response?.workflowId,
        }).unwrap();

        if (data?.status === ValidateConnectionStatus.COMPLETED) {
          dispatch(configApi.util.invalidateTags(["GET_FILE_SERVER_BY_ID"]));
          notify.success("Successfully refreshed the mount / share paths.");
          setDisableRefresh(false);
        }
      }, 2000);
    } catch (error) {
      showErrorOnRefetchFailure(error);
    }
  };

  useEffect(() => {
    return () => {
      interval.current && clearInterval(interval.current);
    };
  }, []);

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
