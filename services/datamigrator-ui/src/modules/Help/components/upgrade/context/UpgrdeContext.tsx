import React, { useState, useCallback, useEffect } from "react";
import { UpgradeContext } from "./context";
import {
  UploadProgress,
  UpgradeProgress,
  BlockingJob,
  UpgradeContextType,
} from "../types/upgrade.types";
import {
  INITIAL_UPLOAD_STATE,
  INITIAL_UPGRADE_STATE,
  BLOCKING_JOB_STATUSES,
  CHUNK_SIZE,
} from "../constants/upgrade.constant";
import { useLazyGetJobRunsQuery } from "@api/jobsApi";
import {
  useGetLatestUploadStatusQuery,
  useInitUploadMutation,
  useUploadChunkMutation,
  useFinalizeUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
} from "@api/upgradeApi";
import { notify } from "@components/notification/NotificationWrapper";
import useSelectedProjectId from "@hooks/useSelectedProjectId";

export const UpgradeProvider = ({ children }: React.PropsWithChildren) => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>(INITIAL_UPLOAD_STATE);

  // Upgrade state
  const [upgradeProgress, setUpgradeProgress] = useState<UpgradeProgress>(INITIAL_UPGRADE_STATE);
  const [blockingJobs, setBlockingJobs] = useState<BlockingJob[]>([]);
  const [showJobWarning, setShowJobWarning] = useState(false);

  // UI visibility flags (determined by DB state)
  const [showUploadUI, setShowUploadUI] = useState(true);
  const [showUpgradeUI, setShowUpgradeUI] = useState(false);
  const [isUploadInProgress, setIsUploadInProgress] = useState(false);
  const [inProgressFileName, setInProgressFileName] = useState<string>('');

  // Get project ID from store
  const { selectedProjectId } = useSelectedProjectId();

  // Fetch latest status from DB on mount
  const { data: latestStatus, isLoading: isLoadingStatus, refetch: refetchStatus } = 
    useGetLatestUploadStatusQuery();

  // API hooks
  const [getJobRuns] = useLazyGetJobRunsQuery();
  const [initUpload] = useInitUploadMutation();
  const [uploadChunk] = useUploadChunkMutation();
  const [finalizeUpload] = useFinalizeUploadMutation();
  const [cancelUpload] = useCancelUploadMutation();
  const [triggerUpgrade] = useTriggerUpgradeMutation();

  // ═══════════════════════════════════════════════════════════════
  // RESTORE STATE FROM DB ON MOUNT
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (latestStatus) {
      setShowUploadUI(latestStatus.showUploadUI);
      setShowUpgradeUI(latestStatus.showUpgradeUI);
      setIsUploadInProgress(latestStatus.isUploadInProgress || false);
      setInProgressFileName(latestStatus.isUploadInProgress ? (latestStatus.fileName || '') : '');

      // If there's a successful upload pending upgrade, restore the upload state
      if (latestStatus.showUpgradeUI && latestStatus.filePath) {
        setUploadProgress({
          ...INITIAL_UPLOAD_STATE,
          status: 'uploaded',
          progress: 100,
          fileName: latestStatus.fileName || '',
          filePath: latestStatus.filePath,
          totalBytes: latestStatus.fileSize || 0,
          uploadedBytes: latestStatus.fileSize || 0,
        });
      }
    }
  }, [latestStatus]);

  // Derived states
  const isUploading = ['hashing', 'uploading', 'finalizing'].includes(uploadProgress.status);
  const isUploaded = uploadProgress.status === 'uploaded';
  const isUpgrading = ['checking-jobs', 'upgrading'].includes(upgradeProgress.status);

  // Handle file selection
  const handleFileSelect = useCallback((file: File | null) => {
    console.log("handleFileSelect called with:", file);  // ADD THIS
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
    setUpgradeProgress(INITIAL_UPGRADE_STATE);
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // UPLOAD HANDLER - Parallel chunk uploads for faster performance
  // ═══════════════════════════════════════════════════════════════
  const PARALLEL_UPLOADS = 5; // Upload 5 chunks simultaneously

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploadProgress((prev) => ({ ...prev, status: "uploading", progress: 0 }));
      
      const initResult = await initUpload({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        checksum: "",
      }).unwrap();

      const { uploadId, totalChunks } = initResult;

      setUploadProgress((prev) => ({
        ...prev,
        uploadId,
        totalChunks,
      }));

      // Create array of chunk indices
      const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
      let completedChunks = 0;

      // Upload function for a single chunk
      const uploadSingleChunk = async (chunkIndex: number) => {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const chunkBlob = selectedFile.slice(start, end);

        await uploadChunk({
          uploadId,
          chunkIndex,
          chunkData: chunkBlob,
        }).unwrap();

        completedChunks++;
        setUploadProgress((prev) => ({
          ...prev,
          currentChunk: completedChunks,
          uploadedBytes: Math.min(completedChunks * CHUNK_SIZE, selectedFile.size),
          progress: Math.round((completedChunks / totalChunks) * 100),
        }));
      };

      // Parallel upload with concurrency limit
      const uploadChunksInParallel = async () => {
        const executing: Promise<void>[] = [];

        for (const chunkIndex of chunkIndices) {
          const promise = uploadSingleChunk(chunkIndex).then(() => {
            executing.splice(executing.indexOf(promise), 1);
          });
          executing.push(promise);

          // If we've reached the concurrency limit, wait for one to finish
          if (executing.length >= PARALLEL_UPLOADS) {
            await Promise.race(executing);
          }
        }

        // Wait for remaining uploads to complete
        await Promise.all(executing);
      };

      await uploadChunksInParallel();

      setUploadProgress((prev) => ({ ...prev, status: "finalizing" }));
      const finalResult = await finalizeUpload(uploadId).unwrap();

      // Check if processing (checksum validation, extraction) failed
      if (finalResult.success === false) {
        const errorMessages = finalResult.errors || [];
        const errorSummary = errorMessages.length > 0 
          ? errorMessages.join('\n') 
          : finalResult.message || 'Upload processing failed';
        
        setUploadProgress((prev) => ({
          ...prev,
          status: "error",
          error: errorSummary,
        }));

        // Show detailed errors in notification
        if (errorMessages.length > 0) {
          notify.error(`Upload validation failed:\n${errorMessages.slice(0, 5).join('\n')}${errorMessages.length > 5 ? `\n...and ${errorMessages.length - 5} more errors` : ''}`);
        } else {
          notify.error(finalResult.message || 'Upload processing failed');
        }
        return;
      }

      setUploadProgress((prev) => ({
        ...prev,
        status: "uploaded",
        progress: 100,
        filePath: finalResult.path,
      }));

      // Update UI flags after successful upload
      setShowUploadUI(false);
      setShowUpgradeUI(true);

      // Refetch status to sync with DB
      refetchStatus();

      notify.success(`File uploaded successfully to: ${finalResult.path}`);
    } catch (error: any) {
      console.error("Upload error:", error);
      setUploadProgress((prev) => ({
        ...prev,
        status: "error",
        error: error?.data?.message || error?.message || "Upload failed",
      }));
      notify.error(error?.data?.message || "Failed to upload file");
    }
  };

  // Cancel upload
  const handleCancelUpload = async () => {
    if (uploadProgress.uploadId) {
      try {
        await cancelUpload(uploadProgress.uploadId).unwrap();
      } catch (error) {
        console.error("Cancel error:", error);
      }
    }
    setUploadProgress((prev) => ({ ...prev, status: "cancelled" }));
    refetchStatus();
  };

  // ═══════════════════════════════════════════════════════════════
  // UPGRADE HANDLER
  // ═══════════════════════════════════════════════════════════════
  const handleUpgrade = async () => {
    if (!isUploaded || !uploadProgress.filePath) {
      notify.error("Please upload a file first");
      return;
    }

    try {
      setUpgradeProgress({ status: "checking-jobs" });

      const jobRuns = await getJobRuns({ projectId: selectedProjectId }).unwrap();
      const blocking = jobRuns.filter((job: any) =>
        BLOCKING_JOB_STATUSES.includes(job.status?.toUpperCase())
      );

      if (blocking.length > 0) {
        setBlockingJobs(
          blocking.map((job: any) => ({
            jobRunId: job.jobRunId,
            jobConfigId: job.jobConfigId,
            status: job.status,
            jobType: job.jobType,
            volumePath: job.volumePath,
            sourceFileServerName: job.sourceFileServerName,
          }))
        );
        setShowJobWarning(true);
        setUpgradeProgress({ status: "blocked" });
        return;
      }

      setUpgradeProgress({ status: "upgrading" });

      await triggerUpgrade({
        filePath: uploadProgress.filePath,
        fileName: uploadProgress.fileName,
      }).unwrap();

      setUpgradeProgress({ status: "success" });

      // Update UI flags after successful upgrade
      setShowUploadUI(true);
      setShowUpgradeUI(false);

      // Refetch status to sync with DB
      refetchStatus();

      notify.success("Upgrade initiated successfully!");
    } catch (error: any) {
      console.error("Upgrade error:", error);
      setUpgradeProgress({
        status: "error",
        error: error?.data?.message || error?.message || "Upgrade failed",
      });
      notify.error(error?.data?.message || "Failed to initiate upgrade");
    }
  };

  // Close job warning
  const closeJobWarning = () => {
    setShowJobWarning(false);
    setUpgradeProgress({ status: "idle" });
  };

  // Reset everything
  const handleReset = () => {
    setSelectedFile(null);
    setUploadProgress(INITIAL_UPLOAD_STATE);
    setUpgradeProgress(INITIAL_UPGRADE_STATE);
    setBlockingJobs([]);
    setShowJobWarning(false);
    setShowUploadUI(true);
    setShowUpgradeUI(false);
  };

  const contextValue: UpgradeContextType = {
    selectedFile,
    handleFileSelect,
    uploadProgress,
    isUploading,
    isUploaded,
    handleUpload,
    handleCancelUpload,
    upgradeProgress,
    blockingJobs,
    showJobWarning,
    isUpgrading,
    handleUpgrade,
    closeJobWarning,
    handleReset,
    showUploadUI,
    showUpgradeUI,
    isLoadingStatus,
    isUploadInProgress,
    inProgressFileName,
  };

  return (
    <UpgradeContext.Provider value={contextValue}>
      {children}
    </UpgradeContext.Provider>
  );
};