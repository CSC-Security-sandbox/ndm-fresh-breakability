"use client";
import ChartInfo from "@components/chartInfo/ChartInfo";
import { Box } from "@components/container/index";
import useFileServerDetails from "@hooks/useFileServerDetails";
import { WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { GcpStorageIcon } from "@netapp/bxp-style/react-icons/Storage";
import JobsAction from "./components/JobsAction";
import TableRenderer from "./components/TableRenderer";
import { useLazyGetFileOverviewQuery } from "@api/reportApi";
import { useEffect, useState } from "react";
import StorageChart from "@components/chartInfo/StorageChart";
import { FileServerOverviewApi } from "@/types/app.type";
import JobChart from "@components/chartInfo/JobsChart";
import { InitialFileServerOverviewApiData } from "./fileServerId.constant";

const FileServerOverView = () => {
  const {
    fileServerDetails,
    getFileServerDetails,
    allExportPaths,
    allWorkersList,
  } = useFileServerDetails();
  const [getFileOverviewApi, { isLoading, data }] = useLazyGetFileOverviewQuery(
    {
      pollingInterval: Number(import.meta.env.VITE_PUBLIC_TIME_INTERVAL),
      skipPollingIfUnfocused: true,
    }
  );
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
        />
        <ChartInfo
          children={<JobChart jobDetails={chartData.jobDetails} />}
          title="Jobs"
          isLoading={isLoading}
          Icon={WorkspaceIcon}
        />
      </Box>
      <TableRenderer
        fileServerDetails={fileServerDetails}
        allExportPaths={allExportPaths}
        allWorkersList={allWorkersList}
        getFileServerDetails={getFileServerDetails}
      />
    </Box>
  );
};

export default FileServerOverView;
