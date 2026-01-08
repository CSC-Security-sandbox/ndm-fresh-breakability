import { formatLength } from "@/utils/common.utils";
import { Box } from "@components/container/index";
import { OverviewTabsPropsType } from "@modules/storage-servers/file-server/file-server-overview/overview.interface";
import { Button, InnerTab } from "@netapp/bxp-design-system-react";
import { useState, useRef, useCallback, useEffect } from "react";
import {
  useStartConsolidatedDiscoveryReportMutation,
  useLazyGetConsolidatedReportStatusByFileServerQuery,
  useLazyDownloadConsolidatedReportQuery,
} from "@api/reportApi";
import { notify } from "@components/notification/NotificationWrapper";
import PermissionAuth from "@/auth/PermissionAuth";
import { USER_PERMISSION_TYPE_ENUM } from "@auth/permissionAuth.constant";
import { FILE_SERVER_STATUS_ENUM } from "@/types/app.type";
import { DownloadMonochromeIcon } from "@netapp/bxp-design-system-react/icons/monochrome";

const POLLING_INTERVAL = 5000; // 5 seconds
const MAX_POLLING_TIME = 30 * 60 * 1000; // 30 minutes max

const OverviewTabs = ({
  fileServerDetails,
  currentTab,
  setCurrentTab,
  allExportPaths,
  allWorkersList,
}: OverviewTabsPropsType) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportReady, setReportReady] = useState(false); 
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null);
  const isActiveSessionRef = useRef(false);

  const [startConsolidatedReport] = useStartConsolidatedDiscoveryReportMutation();
  const [getConsolidatedReportStatus] = useLazyGetConsolidatedReportStatusByFileServerQuery();
  const [downloadConsolidatedReport] = useLazyDownloadConsolidatedReportQuery();

  const isActive = fileServerDetails?.status === FILE_SERVER_STATUS_ENUM.ACTIVE;
  const actualFileServerId = fileServerDetails?.fileServers?.[0]?.id;

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    pollingStartTimeRef.current = null;
  }, []);

  const downloadReport = useCallback(async () => {
    if (!actualFileServerId) return;

    try {
     const statusResponse = await getConsolidatedReportStatus({ fileServerId: actualFileServerId }, false).unwrap();
    
      if (!statusResponse.reportPath) {
        notify.warning("No reports generated for this file server.");
        setReportReady(false);
        return;
      }
      const response = await downloadConsolidatedReport({ fileServerId: actualFileServerId }).unwrap();
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `${fileServerDetails.configName}-consolidated-discovery-report.pdf`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      notify.success("Consolidated discovery report downloaded successfully");
      setReportReady(false);
    } catch (error) {
      console.error("Error downloading report:", error);
      setReportReady(false);
      notify.error("Failed to download the report. Please try again.", 0);
    }
  }, [downloadConsolidatedReport, getConsolidatedReportStatus, fileServerDetails, actualFileServerId]);

  const pollWorkflowStatus = useCallback(async () => {
    if (!actualFileServerId) return;

    try {
      if (pollingStartTimeRef.current && Date.now() - pollingStartTimeRef.current > MAX_POLLING_TIME) {
        stopPolling();
        setIsGenerating(false);
        notify.error("Report generation timed out. Please try again.", 0);
        return;
      }

      const statusResponse = await getConsolidatedReportStatus({ fileServerId: actualFileServerId }, false).unwrap();
  
      if (statusResponse.status === 'COMPLETED') {
        stopPolling();
        setIsGenerating(false);
        if (!statusResponse.reportPath) {
          notify.warning("No discovery jobs found for file server. Please run discovery first.");
        } else {
          setReportReady(true);
          notify.success("Consolidated discovery report generated successfully. Click Download to retrieve.");
        }
        isActiveSessionRef.current = false;
      } else if (statusResponse.status === 'FAILED') {
        stopPolling();
        setIsGenerating(false);
        notify.error(
          "Failed to generate consolidated report. Please try again.",
          0
        );
      } else if (statusResponse.status === 'PARTIAL') {
        stopPolling();
        setIsGenerating(false);
        if (statusResponse.reportPath) {
          setReportReady(true);
          notify.warning(
            "Report generated with some volumes failed. Click Download to retrieve."
          );
        } else {
          notify.warning(
            statusResponse.errorMessage || "Report generation failed for all volumes."
          );
        }
      }
    } catch (error) {
      console.error("Error polling workflow status:", error);
    }
  }, [getConsolidatedReportStatus, downloadReport, stopPolling, actualFileServerId]);

  useEffect(() => {
    if (!actualFileServerId) return;

    const checkExistingWorkflow = async () => {
      try {
        const statusResponse = await getConsolidatedReportStatus({ fileServerId: actualFileServerId }, false).unwrap();
        
        if (statusResponse.status === 'IN_PROGRESS') {
          setIsGenerating(true);
          isActiveSessionRef.current = true;
          pollingStartTimeRef.current = Date.now();
          
          pollingIntervalRef.current = setInterval(() => {
            pollWorkflowStatus();
          }, POLLING_INTERVAL);

          pollWorkflowStatus();
        }else if ((statusResponse.status === 'COMPLETED' || statusResponse.status === 'PARTIAL') && statusResponse.reportPath) {
          setReportReady(true);
        }
      } catch (error) {
        console.log("No existing workflow found or error checking:", error);
      }
    };

    checkExistingWorkflow();

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [actualFileServerId, getConsolidatedReportStatus, pollWorkflowStatus]);

  const handleButtonClick = async () => {
    if (!actualFileServerId) {
      notify.error("File server ID is required", 0);
      return;
    }

    if (reportReady) {
      await downloadReport();
      return;
    }

    setIsGenerating(true);
    isActiveSessionRef.current = true;

    try {
      await startConsolidatedReport({
        fileServerId: actualFileServerId,
        configName: fileServerDetails.configName,
      }).unwrap();

      notify.info("Generating consolidated discovery report. This may take a few minutes...");

      pollingStartTimeRef.current = Date.now();
      pollingIntervalRef.current = setInterval(() => {
        pollWorkflowStatus();
      }, POLLING_INTERVAL);

      pollWorkflowStatus();

    } catch (error) {
      console.error("Error starting consolidated report workflow:", error);
      setIsGenerating(false);
      isActiveSessionRef.current = false;
      notify.error(
        error?.data?.message ||
          "Failed to start consolidated report generation. Please try again.",
        0
      );
    }
  };

  const getButtonText = () => {
    if (isGenerating) return "Generating...";
    if (reportReady) return (
    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <DownloadMonochromeIcon /> Consolidated Discovery Report
    </span>
    );
    return "Consolidate All Discovery Reports";
  };

  return (
    <Box className="flex items-center justify-between my-3">
      <InnerTab variant="card">
        <InnerTab.Button
          isActive={currentTab === 1}
          onClick={() => {
            setCurrentTab(1);
          }}
        >
          Path {`(${formatLength(allExportPaths?.length)})`}
        </InnerTab.Button>
        <InnerTab.Button
          isActive={currentTab === 2}
          onClick={() => {
            setCurrentTab(2);
          }}
        >
          Workers {`(${formatLength(allWorkersList?.length)})`}
        </InnerTab.Button>
      </InnerTab>

      <PermissionAuth permissionName={USER_PERMISSION_TYPE_ENUM.Reports}>
        <Button
          onClick={handleButtonClick}
          disabled={!isActive || isGenerating}
          style={{ whiteSpace: "nowrap" }}
        >
          {getButtonText()}
        </Button>
      </PermissionAuth>
    </Box>
  );
};

export default OverviewTabs;
