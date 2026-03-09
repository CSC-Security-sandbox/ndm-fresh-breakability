import React, { useState, useCallback, useEffect } from "react";
import { useSelector } from "react-redux";
import { UpgradeContext } from "./context";
import {
  UploadProgress,
  UpgradeContextType,
  MulticastStatus,
  BlockingJobs,
} from "../types/upgrade.types";
import {
  INITIAL_UPLOAD_STATE,
} from "../constants/upgrade.constant";
import {
  useGetLatestUploadStatusQuery,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
  useSkipUpgradeMutation,
  useLazyGetMulticastStatusQuery,
  useLazyGetExecutionStatusQuery,
  ExecutionStatusResponse,
} from "@api/upgradeApi";
import { notify } from "@components/notification/NotificationWrapper";
import {
  startBackgroundUpload,
  cancelBackgroundUpload,
} from "@/services/backgroundUploadManager";
import { RootStateType } from "@store/store";
import { BackgroundUploadState } from "@store/reducer/uploadSlice";

// Helper to get user-friendly error message
const getErrorMessage = (error: any, defaultMessage: string): string => {
  const isNet = !error?.status ||
    error?.status === 'FETCH_ERROR' ||
    error?.originalStatus === 0 ||
    error?.message?.toLowerCase().includes('network') ||
    error?.message?.toLowerCase().includes('failed to fetch');
  if (isNet) return "Network error. Please check your connection and try again.";
  return error?.data?.message || error?.message || defaultMessage;
};

export const UpgradeProvider = ({ children }: React.PropsWithChildren) => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Background upload state from Redux (survives navigation)
  const bgUpload = useSelector(
    (state: RootStateType) => (state as any).uploadSlice as BackgroundUploadState
  );

  // Upload state — derived from background upload when active
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>(INITIAL_UPLOAD_STATE);

  // UI visibility flags (determined by DB state)
  const [showUploadUI, setShowUploadUI] = useState(true);
  const [showUpgradeUI, setShowUpgradeUI] = useState(false);  // true when upload complete
  const [isProcessing, setIsProcessing] = useState(false);  // extraction/validation in progress
  const [isUploadInProgress, setIsUploadInProgress] = useState(false);  // interrupted upload detected from DB
  const [inProgressFileName, setInProgressFileName] = useState<string>('');

  // Fetch latest status from DB on mount - with error handling
  const { 
    data: latestStatus, 
    isLoading: isLoadingStatus, 
    isError: isStatusError, 
    error: statusError, 
    refetch: refetchStatus 
  } = useGetLatestUploadStatusQuery();

  // Sync local uploadProgress from Redux background state
  useEffect(() => {
    if (!bgUpload || bgUpload.status === "idle") return;
    setUploadProgress({
      status: bgUpload.status,
      progress: bgUpload.progress,
      currentChunk: bgUpload.currentChunk,
      totalChunks: bgUpload.totalChunks,
      uploadedBytes: bgUpload.uploadedBytes,
      totalBytes: bgUpload.totalBytes,
      error: bgUpload.error || undefined,
      fileName: bgUpload.fileName,
      uploadId: bgUpload.uploadId,
      bundleId: bgUpload.bundleId,
    });
    if (bgUpload.status === "uploaded") {
      setShowUploadUI(false);
      setShowUpgradeUI(true);
      refetchStatus();
    }
  }, [bgUpload, refetchStatus]);

  // Handle status fetch error
  useEffect(() => {
    if (isStatusError) {
      console.error("Failed to fetch upgrade status:", statusError);
      const isNetworkError = (statusError as any)?.status === 'FETCH_ERROR' || 
        (statusError as any)?.error?.includes?.('fetch');
      if (isProcessing && isNetworkError) {
        notify.error(
          "Lost connection to the server. The service may be restarting. Retrying..."
        );
      } else if (!isProcessing) {
        notify.error("Failed to load upgrade status. Please refresh the page.");
      }
    }
  }, [isStatusError, statusError, isProcessing]);

  // Poll for status updates while processing is in progress
  useEffect(() => {
    if (!isProcessing) return;

    const POLL_INTERVAL_MS = 5000; // Poll every 5 second
    const intervalId = setInterval(() => {
      refetchStatus();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isProcessing, refetchStatus]);

  // API hooks
  const [cancelUpload] = useCancelUploadMutation();
  const [triggerUpgrade] = useTriggerUpgradeMutation();
  const [skipUpgrade] = useSkipUpgradeMutation();

  const [isUpgrading, setIsUpgrading] = useState(false);
  const [blockingJobs, setBlockingJobs] = useState<BlockingJobs>(null);
  const [upgradeStatus, setUpgradeStatus] = useState<string | null>(null);

  // Multicast (worker binary distribution) state
  const [workerUploadStatus, setWorkerUploadStatus] = useState<string | null>(null);
  const [multicastStatus, setMulticastStatus] = useState<MulticastStatus | null>(null);
  const [getMulticastStatus] = useLazyGetMulticastStatusQuery();

  // ═══════════════════════════════════════════════════════════════
  // POLL MULTICAST STATUS - 10s interval while workerUploadStatus=IN_PROGRESS
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (workerUploadStatus !== 'IN_PROGRESS' || !latestStatus?.bundleId) return;

    const MULTICAST_POLL_INTERVAL_MS = 10000; // Poll every 10 seconds

    // Fetch immediately on entering IN_PROGRESS state
    const fetchMulticastStatus = async () => {
      try {
        const result = await getMulticastStatus(latestStatus.bundleId!).unwrap();
        setMulticastStatus({
          workflowId: result.workflowId,
          workflowStatus: result.workflowStatus,
          summary: result.summary,
          workers: result.workers,
        });

        // If all workers are done, refetch the main status to update workerUploadStatus
        if (result.summary.inProgress === 0 && result.summary.total > 0) {
          refetchStatus();
        }
      } catch (error) {
        console.error("Failed to fetch multicast status:", error);
      }
    };

    fetchMulticastStatus(); // Immediate first fetch

    const intervalId = setInterval(fetchMulticastStatus, MULTICAST_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [workerUploadStatus, latestStatus?.bundleId, getMulticastStatus, refetchStatus]);

  // Worker upgrade execution state
  const [workerUpgradeStatus, setWorkerUpgradeStatus] = useState<string | null>(null);
  const [isUpgradeExecuting, setIsUpgradeExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatusResponse | null>(null);
  const [getExecutionStatus] = useLazyGetExecutionStatusQuery();

  // ═══════════════════════════════════════════════════════════════
  // POLL EXECUTION STATUS - 10s interval while workerUpgradeStatus=IN_PROGRESS
  // ═══════════════════════════════════════════════════════════════

  // Restore execution status on page refresh when COMPLETED
  useEffect(() => {
    if (workerUpgradeStatus === 'COMPLETED' && !executionStatus && latestStatus?.bundleId) {
      getExecutionStatus(latestStatus.bundleId).unwrap()
        .then((result) => setExecutionStatus(result))
        .catch((error) => {
          if (error?.status === 404) {
            setExecutionStatus(null);
          } else {
            console.error("Failed to fetch execution status:", error);
          }
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerUpgradeStatus, latestStatus?.bundleId]);

  // Poll while IN_PROGRESS
  useEffect(() => {
    if (workerUpgradeStatus !== 'IN_PROGRESS' || !latestStatus?.bundleId) return;

    setIsUpgradeExecuting(true);
    const EXECUTION_POLL_INTERVAL_MS = 10000;

    const fetchStatus = async () => {
      try {
        const result = await getExecutionStatus(latestStatus.bundleId!).unwrap();
        setExecutionStatus(result);

        if (result.upgradeCompleted) {
          setIsUpgradeExecuting(false);
          setWorkerUpgradeStatus('COMPLETED');
          const msg = result.upgradeStatus === 'success'
            ? 'All workers upgraded successfully!'
            : 'Worker upgrade completed with issues. See details below.';
          notify[result.upgradeStatus === 'success' ? 'success' : 'warning'](msg);
        }
      } catch (error: any) {
        if (error?.status !== 404) {
          console.error("Failed to fetch execution status:", error);
        }
      }
    };

    fetchStatus();
    const intervalId = setInterval(fetchStatus, EXECUTION_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [workerUpgradeStatus, latestStatus?.bundleId, getExecutionStatus]);

  // ═══════════════════════════════════════════════════════════════
  // RESTORE STATE FROM DB ON MOUNT / POLL UPDATES
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (latestStatus) {
      // Detect if processing was interrupted (was processing, now failed/upload screen)
      if (isProcessing && !latestStatus.isProcessing && latestStatus.showUploadUI) {
        notify.error(
          "Bundle processing was interrupted. This may have been caused by a service restart. Please upload the bundle again."
        );
      }

      // Detect if processing completed successfully (was processing, now showing upgrade UI)
      if (isProcessing && !latestStatus.isProcessing && latestStatus.showUpgradeUI) {
        notify.success("Bundle processed successfully! You can now proceed with the upgrade.");
      }

      setShowUploadUI(latestStatus.showUploadUI);
      setShowUpgradeUI(latestStatus.showUpgradeUI);
      setIsProcessing(latestStatus.isProcessing || false);
      setIsUploadInProgress(latestStatus.isUploadInProgress || false);
      setWorkerUploadStatus(latestStatus.workerUploadStatus || null);
      setWorkerUpgradeStatus(latestStatus.workerUpgradeStatus || null);
      setUpgradeStatus(latestStatus.upgradeStatus || null);

      // Fetch final worker list when distribution completes
      if (latestStatus.workerUploadStatus === 'COMPLETED' && latestStatus.bundleId && !multicastStatus?.workers?.length) {
        getMulticastStatus(latestStatus.bundleId).unwrap().then((result) => {
          setMulticastStatus({
            workflowId: result.workflowId,
            workflowStatus: result.workflowStatus,
            summary: result.summary,
            workers: result.workers,
          });
        }).catch((err) => console.error('Failed to fetch final multicast status:', err));
      }
      
      // Show filename for processing or interrupted upload state
      setInProgressFileName(
        (latestStatus.isProcessing || latestStatus.isUploadInProgress) 
          ? (latestStatus.fileName || '') 
          : ''
      );

      // If there's a completed upload, restore the upload state
      if (latestStatus.showUpgradeUI && latestStatus.bundleId) {
        setUploadProgress({
          ...INITIAL_UPLOAD_STATE,
          status: 'uploaded',
          progress: 100,
          fileName: latestStatus.fileName || '',
          bundleId: latestStatus.bundleId,
          totalBytes: latestStatus.fileSize || 0,
          uploadedBytes: latestStatus.fileSize || 0,
        });
      }

      // Notify user if previous upload was interrupted/failed
      if (latestStatus.uploadStatus === 'failed') {
        const fileName = latestStatus.fileName ? `"${latestStatus.fileName}"` : 'Previous upload';
        notify.warning(`${fileName} was interrupted. Please try again.`);
      }
    }
  }, [latestStatus]);

  // Derived states
  const isUploading = ['uploading', 'finalizing'].includes(uploadProgress.status);
  const isUploaded = uploadProgress.status === 'uploaded';

  // Handle file selection
  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file);
    if (file) {
      setUploadProgress({
        ...INITIAL_UPLOAD_STATE,
        fileName: file.name,
        totalBytes: file.size,
      });
    } else {
      setUploadProgress(INITIAL_UPLOAD_STATE);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD HANDLER - Runs in background via singleton manager
  // Survives page navigation — state lives in Redux store
  // ═══════════════════════════════════════════════════════════════
  const handleUpload = async () => {
    if (!selectedFile) return;
    startBackgroundUpload(selectedFile);
  };

  // Cancel upload — aborts the background upload and cleans up server-side
  const handleCancelUpload = async () => {
    cancelBackgroundUpload();
    
    if (uploadProgress.uploadId) {
      try {
        await cancelUpload(uploadProgress.uploadId).unwrap();
        notify.info("Upload cancelled");
      } catch (error: any) {
        console.error("Cancel error:", error);
        const errorMessage = getErrorMessage(error, "Failed to cancel upload on server");
        notify.warning(`${errorMessage}. Local state has been reset.`);
      }
    }
    
    setUploadProgress((prev) => ({ ...prev, status: "cancelled" }));
    
    try {
      await refetchStatus();
    } catch (refetchError) {
      console.error("Failed to refresh status after cancel:", refetchError);
    }
  };

  // Reset everything - handles multiple scenarios:
  // 1. Successful upload pending upgrade → mark as skipped
  // 2. Interrupted upload (pod restart) → cancel the stuck DB record
  // 3. Error/cancelled state → just reset UI
  const handleReset = async () => {
    // If there's a successful upload pending upgrade, mark it as skipped in DB
    if (uploadProgress.bundleId && uploadProgress.status === 'uploaded') {
      try {
        await skipUpgrade({ bundleId: uploadProgress.bundleId }).unwrap();
      } catch (error) {
        console.error("Failed to skip upgrade:", error);
      }
    }

    // If there's an interrupted upload (from pod restart), cancel it in DB
    if (isUploadInProgress && uploadProgress.uploadId) {
      try {
        await cancelUpload(uploadProgress.uploadId).unwrap();
      } catch (error) {
        console.error("Failed to cancel interrupted upload:", error);
      }
    } else if (isUploadInProgress) {
      // No uploadId available (session lost), use a dummy ID to trigger cleanup
      try {
        await cancelUpload('orphaned-session').unwrap();
      } catch (error) {
        console.error("Failed to cleanup orphaned upload:", error);
      }
    }

    setSelectedFile(null);
    setUploadProgress(INITIAL_UPLOAD_STATE);
    setShowUploadUI(true);
    setShowUpgradeUI(false);
    setIsUploadInProgress(false);
    setIsUpgradeExecuting(false);
    setExecutionStatus(null);
    setWorkerUpgradeStatus(null);
    setUpgradeStatus(null);

    // Refresh status from DB to sync state
    try {
      await refetchStatus();
    } catch (refetchError) {
      console.error("Failed to refresh status after reset:", refetchError);
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // UPGRADE HANDLER (DRAFT - Ready to activate)
  // Calls triggerUpgrade API endpoint
  // ═══════════════════════════════════════════════════════════════

  const handleUpgrade = async () => {

    // Guard: Check if file is uploaded and bundleId exists
    if (!isUploaded || !uploadProgress.bundleId) {
      notify.error("Please upload a file first");
      return;
    }

    try {
      setIsUpgrading(true);
      setBlockingJobs(null);

      const result = await triggerUpgrade({
        bundleId: uploadProgress.bundleId,
      }).unwrap();

      if (result.success) {
        notify.success(result.message || "Upgrade initiated successfully!");
        setShowUploadUI(true);
        setShowUpgradeUI(false);
        
        try {
          await refetchStatus();
        } catch (refetchError) {
          console.error("Failed to refresh status after upgrade:", refetchError);
        }
      } else if (result.canUpgrade === false) {
        setBlockingJobs({
          runningJobs: result.runningJobs || [],
          scheduledJobs: result.scheduledJobs || [],
          activeJobConfigs: result.activeJobConfigs || [],
        });
        notify.error(result.message || "Cannot upgrade while jobs are active.");
      } else {
        notify.error(result.message || "Upgrade failed");
      }
    } catch (error: any) {
      console.error("Upgrade error:", error);
      const errorMessage = getErrorMessage(error, "Upgrade failed");
      notify.error(errorMessage);
    } finally {
      setIsUpgrading(false);
    }
  };

  const contextValue: UpgradeContextType = {
    selectedFile,
    handleFileSelect,
    uploadProgress,
    isUploading,
    isUploaded,
    handleUpload,
    handleCancelUpload,
    handleUpgrade,
    isUpgrading,
    blockingJobs,
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isLoadingStatus,
    isProcessing,
    isUploadInProgress,
    inProgressFileName,
    workerUploadStatus,       // IDLE | IN_PROGRESS | COMPLETED
    multicastStatus,          // Per-worker distribution summary (populated while polling)
    upgradeStatus,
    workerUpgradeStatus,      // IDLE | IN_PROGRESS | COMPLETED
    isUpgradeExecuting,
    executionStatus,
  };

  return (
    <UpgradeContext.Provider value={contextValue}>
      {children}
    </UpgradeContext.Provider>
  );
};
