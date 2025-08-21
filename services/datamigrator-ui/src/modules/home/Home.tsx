import { useEffect, useState } from "react";
import ChartInfo from "@components/chartInfo/ChartInfo";
import { Box } from "@components/container/index";
import { Button } from "@netapp/bxp-design-system-react";
import { WorkspaceIcon } from "@netapp/bxp-style/react-icons/General";
import { GcpStorageIcon } from "@netapp/bxp-style/react-icons/Storage";
import { useNavigate } from "react-router-dom";
import NoticeBoard from "@modules/home/components/NoticeBoard";
import { useLazyGetProjectOverviewQuery } from "@/api/reportApi";
import useSelectedProjectId from "@hooks/useSelectedProjectId";
import { notify } from "@components/notification/NotificationWrapper";
import { FileServerOverviewApi } from "@/types/app.type";
import StorageChart from "@components/chartInfo/StorageChart";
import JobChart from "@components/chartInfo/JobsChart";
import WorkerInstallation from "@components/top-nav-bar/setting/ManageProjects/WorkerInstructions";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { InitialFileServerOverviewApiData } from "@modules/storage-servers/file-server/file-server-overview/fileServerId.constant";

const Home = () => {
  const { selectedProjectId } = useSelectedProjectId();
  const navigate = useNavigate();
  const [getProjectOverviewApi, { data, isLoading, isError }] =
    useLazyGetProjectOverviewQuery();

  const [chartData, setChartData] = useState<FileServerOverviewApi>(
    InitialFileServerOverviewApiData
  );

  useEffect(() => {
    if (data !== undefined) setChartData(data);
  }, [data]);

  useEffect(() => {
    if (selectedProjectId) {
      getProjectOverviewApi({ projectId: selectedProjectId })
        .unwrap()
        .catch((err) => {
          notify.error("Failed to fetch overview data.");
          console.error({ err, level: "Dashboard/Project Overview API" });
        });
    }
  }, [selectedProjectId]);

  const handleAddFileServerButton = () => {
    navigate("/new-file-server");
  };
  return (
    <Box className="p-6">
      <Box className="flex justify-end gap-2">
        <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.ManageConfig}>
          <Button onClick={handleAddFileServerButton}>Add File Server</Button>
          <WorkerInstallation
            label="View Instruction To Setup Worker"
            project_id={selectedProjectId}
          />
        </PermissionAuth>
      </Box>
      <Box className="flex gap-3 my-4">
        <Box className="flex flex-col gap-3 w-6/12">
          <ChartInfo
            children={<JobChart jobDetails={chartData.jobDetails} />}
            title="Jobs"
            Icon={WorkspaceIcon}
            isLoading={isLoading}
            isError={isError}
            lastRefreshed={chartData.lastRefreshed}
          />
          <ChartInfo
            children={
              <StorageChart storageDetails={chartData.storageDetails} />
            }
            title="Storage"
            Icon={GcpStorageIcon}
            isLoading={isLoading}
            isError={isError}
            lastRefreshed={chartData.lastRefreshed}
          />
        </Box>
        <NoticeBoard />
      </Box>
    </Box>
  );
};

export default Home;
