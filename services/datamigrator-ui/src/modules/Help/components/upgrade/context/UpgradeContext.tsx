import React, { useState, useCallback, useEffect } from "react";
import { UpgradeContext } from "./context";
import {
  UploadProgress,
  UpgradeContextType,
  MulticastStatus,
} from "../types/upgrade.types";
import {
  INITIAL_UPLOAD_STATE,
  CHUNK_SIZE,
} from "../constants/upgrade.constant";
import {
  useGetLatestUploadStatusQuery,
  useInitUploadMutation,
  useUploadChunkMutation,
  useProcessUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
  useSkipUpgradeMutation,
  useLazyGetMulticastStatusQuery,
} from "@api/upgradeApi";
import { notify } from "@components/notification/NotificationWrapper";

// Constants for validation
const MAX_FILE_SIZE = 20 * 1024 * 1024 * 1024; // 20GB max file size
const ALLOWED_EXTENSION = '.tar.gz';

// Helper to determine if error is a network error 
const isNetworkError = (error: any): boolean => {
  return !error?.status ||                       // request never reached the server
    error?.status === 'FETCH_ERROR' ||          // Network request failed entirely
    error?.originalStatus === 0 ||              // CORS blocked, server down, no internet
    error?.message?.toLowerCase().includes('network') || // network error
    error?.message?.toLowerCase().includes('failed to fetch'); // Failed to fetch
};

// Helper to get user-friendly error message
const getErrorMessage = (error: any, defaultMessage: string): string => {
  if (isNetworkError(error)) {
    return "Network error. Please check your connection and try again.";
  }
  return error?.data?.message || error?.message || defaultMessage;
};

export const UpgradeProvider = ({ children }: React.PropsWithChildren) => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload state
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
  const [initUpload] = useInitUploadMutation();
  const [uploadChunk] = useUploadChunkMutation();
  const [processUpload] = useProcessUploadMutation();
  const [cancelUpload] = useCancelUploadMutation();
  const [triggerUpgrade] = useTriggerUpgradeMutation();
  const [skipUpgrade] = useSkipUpgradeMutation();

  const [isUpgrading, setIsUpgrading] = useState(false);

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
  // UPLOAD HANDLER - Parallel chunk uploads for faster performance
  // ═══════════════════════════════════════════════════════════════
  const PARALLEL_UPLOADS = 5; // Upload 5 chunks simultaneously

  // Pre-upload validation
  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith(ALLOWED_EXTENSION)) {
      return { 
        valid: false, 
        error: `Invalid file type. Only ${ALLOWED_EXTENSION} files are supported.` 
      };
    }

    // Validate file name format (should be upgrade-{version}.tar.gz)
    const versionMatch = file.name.match(/^upgrade-.+\.tar\.gz$/i);
    if (!versionMatch) {
      return { 
        valid: false, 
        error: 'Invalid file name format. Expected: upgrade-{version}.tar.gz (e.g., upgrade-v2.1.0.tar.gz)' 
      };
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      const maxSizeGB = MAX_FILE_SIZE / (1024 * 1024 * 1024);
      return { 
        valid: false, 
        error: `File too large. Maximum size: ${maxSizeGB}GB` 
      };
    }

    if (file.size < 1 * 1024 * 1024) { // 1MB
      return { 
        valid: false, 
        error: 'File is smaller than 1MB. Please select a valid upgrade bundle.' 
      };
    }

    return { valid: true };
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    // Pre-upload validation
    const validation = validateFile(selectedFile);
    if (!validation.valid) {
      notify.error(validation.error!);
      setUploadProgress((prev) => ({
        ...prev,
        status: "error",
        error: validation.error,
      }));
      return;
    }

    // Store uploadId at function scope so it's available in catch block
    let currentUploadId: string | undefined;

    try {
      setUploadProgress((prev) => ({ ...prev, status: "uploading", progress: 0 }));
      
      const initResult = await initUpload({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
      }).unwrap();

      const { uploadId, totalChunks } = initResult;
      currentUploadId = uploadId; // Store for error handling

      setUploadProgress((prev) => ({
        ...prev,
        uploadId,
        totalChunks,
      }));

      // Create array of chunk indices
      const chunkIndices = Array.from({ length: totalChunks }, (_, i) => i);
      let completedChunks = 0;
      let uploadAborted = false; // Flag to stop new chunk uploads on error

      // Upload function for a single chunk with error handling
      const uploadSingleChunk = async (chunkIndex: number): Promise<void> => {
        if (uploadAborted) {
          throw new Error('Upload aborted due to previous chunk failure');
        }

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const chunkBlob = selectedFile.slice(start, end);

        try {
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
        } catch (chunkError: any) {
          // Mark as aborted to stop other chunks from uploading
          uploadAborted = true;
          console.error(`Chunk ${chunkIndex} upload failed:`, chunkError);
          throw chunkError; // Re-throw to fail the parallel upload
        }
      };

      // Parallel upload with concurrency limit and error handling
      const uploadChunksInParallel = async () => {
        const executing: Promise<void>[] = [];

        for (const chunkIndex of chunkIndices) {
          // Stop scheduling new chunks if upload was aborted
          if (uploadAborted) {
            break;
          }

          const promise = uploadSingleChunk(chunkIndex).then(() => {
            // When done, remove from executing array
            const index = executing.indexOf(promise);
            if (index > -1) {
              executing.splice(index, 1);
            }
          }).catch((err) => {
            // Remove from executing and re-throw
            const index = executing.indexOf(promise);
            if (index > -1) {
              executing.splice(index, 1);
            }
            throw err;
          });
          executing.push(promise);

          // If we've reached the concurrency limit, wait for one to finish
          if (executing.length >= PARALLEL_UPLOADS) {
            await Promise.race(executing);
          }
        }

        // Wait for remaining uploads to complete
        if (executing.length > 0) {
          await Promise.all(executing);
        }
      };

      await uploadChunksInParallel();

      setUploadProgress((prev) => ({ ...prev, status: "finalizing" }));
      const finalResult = await processUpload(uploadId).unwrap();

      // Check if processing (checksum validation, extraction) failed
      if (finalResult.success === false) {
        const errorMessages = finalResult.errors || [];
        const errorSummary = errorMessages.length > 0 
          ? errorMessages.join('\n') 
          : finalResult.message || 'Upload processing failed';
        
        // Use 'validation_failed' status for checksum/file validation errors
        const isValidationError = errorMessages.length > 0 || 
          finalResult.message?.toLowerCase().includes('validation') ||
          finalResult.message?.toLowerCase().includes('checksum');
        
        setUploadProgress((prev) => ({
          ...prev,
          status: isValidationError ? "validation_failed" : "error",
          error: errorSummary,
        }));

        // Show detailed errors in notification
        if (errorMessages.length > 0) {
          notify.error(`Checksum validation failed:\n${errorMessages.slice(0, 5).join('\n')}${errorMessages.length > 5 ? `\n...and ${errorMessages.length - 5} more errors` : ''}`);
        } else {
          notify.error(finalResult.message || 'Upload processing failed');
        }
        return;
      }

      setUploadProgress((prev) => ({
        ...prev,
        status: "uploaded",
        progress: 100,
        bundleId: finalResult.bundleId,
      }));

      // Update UI flags after successful upload
      setShowUploadUI(false);
      setShowUpgradeUI(true);

      // Refetch status to sync with DB
      try {
        await refetchStatus();
      } catch (refetchError) {
        console.error("Failed to refresh status after upload:", refetchError);
        // Don't fail the upload, just log the error
      }

      notify.success(`File uploaded successfully to: ${finalResult.path}`);
    } catch (error: any) {
      console.error("Upload error:", error);
      
      // Only cancel if error happened during chunk upload phase (not during processing)
      // During processing, the backend already marks DB as FAILED if something goes wrong
      const wasUploadingChunks = uploadProgress.status === 'uploading';
      
      if (currentUploadId && wasUploadingChunks) {
        try {
          await cancelUpload(currentUploadId).unwrap();
        } catch (cancelError) {
          console.error("Failed to cancel upload:", cancelError);
        }
      }
      
      // Differentiate between network and server errors
      const errorMessage = getErrorMessage(error, "Upload failed");
      
      setUploadProgress((prev) => ({
        ...prev,
        status: "error",
        error: errorMessage,
      }));
      notify.error(errorMessage);
    }
  };

  // Cancel upload with proper error handling
  const handleCancelUpload = async () => {
    if (uploadProgress.uploadId) {
      try {
        await cancelUpload(uploadProgress.uploadId).unwrap();
        notify.info("Upload cancelled");
      } catch (error: any) {
        console.error("Cancel error:", error);
        // Notify user about the failure but still update local state
        const errorMessage = getErrorMessage(error, "Failed to cancel upload on server");
        notify.warning(`${errorMessage}. Local state has been reset.`);
      }
    }
    
    // Always update local state to cancelled
    setUploadProgress((prev) => ({ ...prev, status: "cancelled" }));
    
    // Refetch status with error handling
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
  // To activate: Set UPGRADE_ENABLED = true below
  // ═══════════════════════════════════════════════════════════════
  const UPGRADE_ENABLED = false; // <-- Set to true to activate upgrade functionality

  const handleUpgrade = async () => {
    // Guard: Check if upgrade is enabled
    if (!UPGRADE_ENABLED) {
      console.log("Upgrade button clicked - functionality not yet enabled");
      notify.info("Upgrade functionality is not yet enabled. Please contact support.");
      return;
    }

    // Guard: Check if file is uploaded and bundleId exists
    if (!isUploaded || !uploadProgress.bundleId) {
      notify.error("Please upload a file first");
      return;
    }

    try {
      setIsUpgrading(true);

      // Call the triggerUpgrade API with bundleId (primary key - fast query)
      const result = await triggerUpgrade({
        bundleId: uploadProgress.bundleId,
      }).unwrap();

      if (result.success) {
        notify.success(result.message || "Upgrade initiated successfully!");
        
        // Reset UI state after successful upgrade
        setShowUploadUI(true);
        setShowUpgradeUI(false);
        
        // Refetch status to sync with DB
        try {
          await refetchStatus();
        } catch (refetchError) {
          console.error("Failed to refresh status after upgrade:", refetchError);
        }
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
    handleUpgrade,            // DRAFT - ready to activate (set UPGRADE_ENABLED = true)
    isUpgrading,
    handleReset,
    showUploadUI,
    showUpgradeUI,            // true when upload complete, ready for upgrade
    isLoadingStatus,
    isProcessing,             // true when extracting/validating (should NOT be cancelled)
    isUploadInProgress,       // true when interrupted upload detected from DB
    inProgressFileName,
    workerUploadStatus,       // IDLE | IN_PROGRESS | COMPLETED
    multicastStatus,          // Per-worker distribution summary (populated while polling)
  };

  return (
    <UpgradeContext.Provider value={contextValue}>
      {children}
    </UpgradeContext.Provider>
  );
};
