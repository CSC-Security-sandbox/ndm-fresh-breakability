import React, { useState, useCallback } from "react";
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
  useInitUploadMutation,
  useUploadChunkMutation,
  useFinalizeUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
} from "@api/upgradeApi";
import { notify } from "@components/notification/NotificationWrapper";
import { useSelector } from "react-redux";
import { RootStateType } from "@store/store";

export const UpgradeProvider = ({ children }: React.PropsWithChildren) => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>(INITIAL_UPLOAD_STATE);

  // Upgrade state
  const [upgradeProgress, setUpgradeProgress] = useState<UpgradeProgress>(INITIAL_UPGRADE_STATE);
  const [blockingJobs, setBlockingJobs] = useState<BlockingJob[]>([]);
  const [showJobWarning, setShowJobWarning] = useState(false);

  // Get project ID from store
  const selectedProjectId = useSelector(
    (state: RootStateType) => state?.projectSlice?.selectedProjectId
  );

  // API hooks
  const [getJobRuns] = useLazyGetJobRunsQuery();
  const [initUpload] = useInitUploadMutation();
  const [uploadChunk] = useUploadChunkMutation();
  const [finalizeUpload] = useFinalizeUploadMutation();
  const [cancelUpload] = useCancelUploadMutation();
  const [triggerUpgrade] = useTriggerUpgradeMutation();

  // Derived states
  const isUploading = ['hashing', 'uploading', 'finalizing'].includes(uploadProgress.status);
  const isUploaded = uploadProgress.status === 'uploaded';
  const isUpgrading = ['checking-jobs', 'upgrading'].includes(upgradeProgress.status);

  // Calculate SHA256 checksum
  const calculateChecksum = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

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
    setUpgradeProgress(INITIAL_UPGRADE_STATE);
  }, []);

  // ============================================
  // UPLOAD HANDLER - Uploads file to VM
  // ============================================
  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      // Step 1: Calculate checksum
      setUploadProgress((prev) => ({ ...prev, status: "hashing" }));
      const checksum = await calculateChecksum(selectedFile);

      // Step 2: Initialize upload session
      const initResult = await initUpload({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        checksum,
      }).unwrap();

      const { uploadId, totalChunks } = initResult;

      setUploadProgress((prev) => ({
        ...prev,
        status: "uploading",
        uploadId,
        totalChunks,
      }));

      // Step 3: Upload chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const chunkBlob = selectedFile.slice(start, end);

        await uploadChunk({
          uploadId,
          chunkIndex: i,
          chunkData: chunkBlob,
        }).unwrap();

        setUploadProgress((prev) => ({
          ...prev,
          currentChunk: i + 1,
          uploadedBytes: end,
          progress: Math.round(((i + 1) / totalChunks) * 100),
        }));
      }

      // Step 4: Finalize - assemble chunks and verify checksum
      setUploadProgress((prev) => ({ ...prev, status: "finalizing" }));
      const finalResult = await finalizeUpload(uploadId).unwrap();

      setUploadProgress((prev) => ({
        ...prev,
        status: "uploaded",
        progress: 100,
        filePath: finalResult.path, // Path on VM
      }));

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
  };

  // ============================================
  // UPGRADE HANDLER - Checks jobs then triggers upgrade
  // ============================================
  const handleUpgrade = async () => {
    if (!isUploaded || !uploadProgress.filePath) {
      notify.error("Please upload a file first");
      return;
    }

    try {
      // Step 1: Check for blocking jobs
      setUpgradeProgress({ status: "checking-jobs" });

      const jobRuns = await getJobRuns({ projectId: selectedProjectId }).unwrap();
      const blocking = jobRuns.filter((job: any) =>
        BLOCKING_JOB_STATUSES.includes(job.status?.toUpperCase())
      );

      if (blocking.length > 0) {
        // Jobs are running - show warning
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

      // Step 2: No jobs running - trigger upgrade
      setUpgradeProgress({ status: "upgrading" });

      await triggerUpgrade({
        filePath: uploadProgress.filePath,
        fileName: uploadProgress.fileName,
      }).unwrap();

      setUpgradeProgress({ status: "success" });
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
  };

  return (
    <UpgradeContext.Provider value={contextValue}>
      {children}
    </UpgradeContext.Provider>
  );
};