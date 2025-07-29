import ChartInfo from "@components/chartInfo/ChartInfo";
import { Box } from "@components/container/index";
import useFileServerDetails from "@hooks/useFileServerDetails";
import { WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { GcpStorageIcon } from "@netapp/bxp-style/react-icons/Storage";
import JobsAction from "@modules/storage-servers/file-server/file-server-overview/components/JobsAction";
import TableRenderer from "@modules/storage-servers/file-server/file-server-overview/components/TableRenderer";
import { useLazyGetFileOverviewQuery } from "@api/reportApi";
import { useEffect, useState } from "react";
import StorageChart from "@components/chartInfo/StorageChart";
import { FileServerOverviewApi } from "@/types/app.type";
import JobChart from "@components/chartInfo/JobsChart";
import { InitialFileServerOverviewApiData } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";
import { notify } from "@components/notification/NotificationWrapper";

const FileServerOverView = () => {
  const {
    fileServerDetails,
    allExportPaths,
    allWorkersList,
    refetch,
    isFetching,
  } = useFileServerDetails();
  const [getFileOverviewApi, { isLoading, isError, data }] =
    useLazyGetFileOverviewQuery({
      pollingInterval: Number(
        window?.env?.VITE_TIME_INTERVAL || import.meta.env.VITE_TIME_INTERVAL
      ),
      skipPollingIfUnfocused: true,
    });
  const [chartData, setChartData] = useState<FileServerOverviewApi>(
    InitialFileServerOverviewApiData
  );

  useEffect(() => {
    if (data !== undefined) setChartData(data);
  }, [data]);

  useEffect(() => {
    if (fileServerDetails.id) {
      getFileOverviewApi({ fileServerId: fileServerDetails.id })
        .unwrap()
        .catch((err) => {
          console.error({ error: err, level: "File overview" });
        });
    }
  }, [fileServerDetails.id]);

  useEffect(() => {
    if (isError) {
      console.error({ error: isError, level: "File overview" });
      notify.error("Failed to fetch file server overview data.");
    }
  }, [isError]);

  return (
    <Box className="p-8">
      <JobsAction fileServerDetails={fileServerDetails} />
      <Box className="flex gap-3 w-full my-4">
        <ChartInfo
          children={
            <StorageChart
              storageDetails={{
                ...chartData.storageDetails,
                totalFileServers: undefined, // api is returning 0, but as this is file server data, hence we do not need to show number of file servers
              }}
            />
          }
          title="Storage"
          Icon={GcpStorageIcon}
          isLoading={isLoading}
          isError={isError}
        />
        <ChartInfo
          children={<JobChart jobDetails={chartData.jobDetails} />}
          title="Jobs"
          Icon={WorkspaceIcon}
          isLoading={isLoading}
          isError={isError}
        />
      </Box>
      <TableRenderer
        fileServerDetails={fileServerDetails}
        allExportPaths={allExportPaths}
        allWorkersList={allWorkersList}
        refetch={refetch}
        isFetching={isFetching}
      />
    </Box>
  );
};

export default FileServerOverView;
