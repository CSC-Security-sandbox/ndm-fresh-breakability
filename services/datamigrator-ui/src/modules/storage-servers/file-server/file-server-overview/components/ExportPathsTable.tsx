import {
  configApi,
  useLazyDownloadExportPathSourceTemplateQuery,
  useLazyRefetchConfigExportPathsQuery,
} from "@api/configApi";
import { Box } from "@components/container/index";
import { notify } from "@components/notification/NotificationWrapper";
import TableWrapper from "@components/table-wrapper/TableWrapper";
import ReFreshExportPathsTime from "@modules/storage-servers/file-server/file-server-overview/components/ReFreshExportPathsTime";
import {
  BULK_DISCOVERY,
  EXPORT_PATHS_TABLE_COLS_DEF,
} from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { ExportPathsTablePropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import { Button } from "@netapp/bxp-design-system-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLazyCheckConnectionRespQuery } from "@api/workerManagerApi";
import {
  FILE_SERVER_STATUS_ENUM,
  ValidateConnectionStatus,
} from "@/types/app.type";
import { useDispatch } from "react-redux";
import { MAX_RETRY_API_ATTEMPTS } from "@/utils/constants";
import BulkManualUploadFile from "@modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/components/BulkManualUploadFile";
import {
  getFileServerId,
  hasManualUploadPath,
} from "@modules/storage-servers/file-server/file-server-overview/file-server.utils";
import {
  EXPORT_PATH_FILE_UPLOAD_IN_PROGRESS_TEXT,
  NO_DATA_TEXT,
} from "@modules/storage-servers/file-server/components/steps/Credentials/export-path-source.constants";
import { handleDownloadTemplate } from "@modules/storage-servers/file-server/file-server-overview/bulk-migrate/bulk-migrate.utils";

const ExportPathsTable = ({
  fileServerDetails,
  allExportPaths,
  showRefetch,
  isRowSelectingEnabled = false,
  setSelectedExportPathsIds,
  defaultColumnState,
  notReachableExportPaths,
  refetch,
  isFetching,
  jobType,
}: ExportPathsTablePropsType) => {
  const interval = useRef<NodeJS.Timeout | null>(null);
  const dispatch = useDispatch();

  const [disableRefresh, setDisableRefresh] = useState<boolean>(false);

  const [reFetchExportPathsApi] = useLazyRefetchConfigExportPathsQuery();
  const [downloadTemplate] = useLazyDownloadExportPathSourceTemplateQuery();
  const [getWorkFlowStatus] = useLazyCheckConnectionRespQuery();

  const isDraftStatus =
    fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.DRAFT;

  const isManualUploadPath = useMemo(() => {
    if (fileServerDetails?.fileServers)
      return hasManualUploadPath(fileServerDetails);
    return false;
  }, [fileServerDetails?.fileServers]);

  const isRefreshDisabled =
    !fileServerDetails?.isRefreshAvailable || disableRefresh || isDraftStatus || isManualUploadPath;

  const tableStateProps = {
    columns: EXPORT_PATHS_TABLE_COLS_DEF,
    rows: allExportPaths,
    isRowSelecting: isRowSelectingEnabled,
    isSorting: true,
    pageSize: 10,
    defaultColumnState: defaultColumnState,
  };

  const fileServerId = useMemo(() => {
    if (fileServerDetails?.fileServers) {
      return getFileServerId(fileServerDetails, "NFS");
    }
  }, [fileServerDetails?.fileServers]);

  const showErrorOnRefetchFailure = (error: Error) => {
    setDisableRefresh(false);
    if (interval.current) {
      clearInterval(interval.current);
    }

    notify.error(
      `${error?.data?.message || error?.message || "unknown."}`
    );
    console.error({ level: "File server overview - refresh list.", error });
  };

  // REFETCH EXPORT PATHS
  const handleRefetchExportPaths = async () => {
    // Skip refresh for manually uploaded paths - no backend discovery needed
    if (isManualUploadPath) {
      return;
    }

    setDisableRefresh(true);
    try {
      let retryCount = 0;
      
      // Dell Isilon: Pass configId and fileServerId separately for zone-specific refresh
      // Other NAS: Only pass fileServerId (which is actually the config ID)
      const isDellIsilon = fileServerDetails?.serverType === "Dell";
      
      const response = await reFetchExportPathsApi({
        configId: isDellIsilon ? fileServerDetails.id : undefined,
        fileServerId: isDellIsilon ? fileServerId : fileServerDetails.id,
      }).unwrap();

      if (isDellIsilon) {
        // Dell Isilon refresh is synchronous - already complete
        dispatch(configApi.util.invalidateTags(["GET_FILE_SERVER_BY_ID"]));
        notify.success(response?.message || "Successfully refreshed the mount / share paths.");
        setDisableRefresh(false);
        
        if (refetch) {
          refetch();
        }
        return;
      }

      // Other NAS: Refresh is asynchronous via workflow
      // Response structure: { workflowId: "ListPathsWorkflow-..." }
      interval.current = setInterval(async () => {
        const data = await getWorkFlowStatus({
          id: response?.workflowId,
        }).unwrap();

        if (data?.status === ValidateConnectionStatus.COMPLETED) {
          dispatch(configApi.util.invalidateTags(["GET_FILE_SERVER_BY_ID"]));
          notify.success("Successfully refreshed the mount / share paths.");
          setDisableRefresh(false);
          clearInterval(interval.current);

          if (refetch) {
            refetch();
          }
        } else if (data?.status === ValidateConnectionStatus.TERMINATED) {
          const error = new Error(
            `Seems like request to refresh paths got terminated, please try again.`
          );
          showErrorOnRefetchFailure(error);
        } else if (++retryCount === MAX_RETRY_API_ATTEMPTS) {
          const error = new Error(
            `Request timed out after ${MAX_RETRY_API_ATTEMPTS} attempts.`
          );
          showErrorOnRefetchFailure(error);
        }
      }, 2000);
    } catch (error) {
      showErrorOnRefetchFailure(error);
    }
  };

  useEffect(() => {
    return () => {
      if (interval.current) {
        clearInterval(interval.current);
      }
    };
  }, []);

  const FETCHING_DETAILS = (
    <Box className="flex gap-1 justify-end">
      <ReFreshExportPathsTime fileServerDetails={fileServerDetails} />
    </Box>
  );
  const handleDownloadReport = () => {
    handleDownloadTemplate(
      () =>
        downloadTemplate({
          type: "uploaded-paths",
          fileServerId: fileServerId,
        }),
      "uploaded_export_paths.csv"
    );
  };

  const getBulkManualUpload = () => (
    <BulkManualUploadFile
      fileServerDetails={fileServerDetails}
      allExportPaths={allExportPaths}
      handleReportDownload={handleDownloadReport}
    />
  );

  const contentValue = useMemo(() => {
    if (jobType === BULK_DISCOVERY) return "";

    if (!isManualUploadPath) return showRefetch ? FETCHING_DETAILS : "";

    return allExportPaths.length > 0 ? getBulkManualUpload() : "";
  }, [isManualUploadPath, showRefetch, allExportPaths]);

  const getDataLabel = useCallback(() => {
    if (jobType === BULK_DISCOVERY) return NO_DATA_TEXT;

    if (fileServerDetails?.isUploadInProgress)
      return EXPORT_PATH_FILE_UPLOAD_IN_PROGRESS_TEXT;

    return isManualUploadPath ? getBulkManualUpload() : NO_DATA_TEXT;
  }, [fileServerDetails, isManualUploadPath]);

  return (
    <TableWrapper
      tableStateProps={tableStateProps}
      content={contentValue}
      showLabel={false}
      refetchTableData={handleRefetchExportPaths}
      isRefreshing={isFetching || disableRefresh}  
      showRefresh={!isManualUploadPath}
      handleSelection={
        isRowSelectingEnabled ? setSelectedExportPathsIds : undefined
      }
      notReachableExportPaths={notReachableExportPaths}
      noDataLabel={getDataLabel()}
    />
  );
};

export default ExportPathsTable;
