import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export interface LatestUploadStatusResponse {
  hasUpload: boolean;
  bundleId?: string;                 // Use bundleId for triggerUpgrade (primary key - fast query)
  uploadStatus?: string;
  upgradeStatus?: string;
  fileName?: string;
  fileSize?: number;
  version?: string;
  uploadCompletedAt?: string;
  upgradeCompletedAt?: string;
  showUploadUI: boolean;
  showUpgradeUI: boolean;
  isProcessing?: boolean;            // true when extracting/validating (DO NOT cancel)
  isUploadInProgress?: boolean;      // true when chunks are being uploaded (can be cancelled)
  isUpgradeInProgress?: boolean;
  workerUploadStatus?: string;       // IDLE | IN_PROGRESS | COMPLETED - worker binary distribution status
  workerUpgradeStatus?: string;      // IDLE | IN_PROGRESS | COMPLETED - worker upgrade execution status
  // Processing error fields — populated by doProcessUpload on failure
  processingErrors?: string[] | null;
  isValidationFailure?: boolean;
  deactivatedJobConfigIds?: string[] | null;  // persisted to DB before upgrade — survives CP restart
  stoppedJobRunIds?: string[] | null;          // persisted to DB before upgrade — survives CP restart
}

export interface WorkerExecutionItem {
  workerId: string;
  workerName?: string;
  ipAddress?: string;
  platform?: string;
  currentVersion?: string;
  executionStatus: string;
  upgradeCompletedAt?: string;
}

export interface ExecutionStatusResponse {
  workflowId: string;
  workflowStatus: string;
  upgradeCompleted: boolean;
  upgradeStatus: 'success' | 'failure' | 'in_progress';
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    notStarted: number;
  };
  completed: WorkerExecutionItem[];
  notCompleted: WorkerExecutionItem[];
  notStaged: WorkerExecutionItem[];
}

export interface MulticastStatusResponse {
  workflowId: string;
  workflowStatus: string;
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    failed: number;
    idle: number;
  };
  workers: Array<{
    workerId: string;
    workerName?: string;
    ipAddress?: string;
    platform?: string;
    currentVersion?: string;
    stagedVersion?: string;
    bundleStatus: string;
    healthy?: boolean;
    lastSeen?: string;
  }>;
  workflowResult?: any;
}

export const upgradeApi = createApi({
  reducerPath: "upgradeApi",
  tagTypes: ["UPLOAD_STATUS"],

  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_ADMIN_SERVICE_URL ||
      import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders,
  }),

  endpoints: (builder) => ({
    // Get latest upload status for UI state restoration
    getLatestUploadStatus: builder.query<LatestUploadStatusResponse, void>({
      query: () => "/upgrade/latest-upload-status",
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      providesTags: ["UPLOAD_STATUS"],
    }),

    // Initialize upload session
    initUpload: builder.mutation({
      query: (body: { fileName: string; fileSize: number }) => ({
        url: "/upgrade/init",
        method: "POST",
        body,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Upload a single chunk
    uploadChunk: builder.mutation({
      query: ({
        uploadId,
        chunkIndex,
        chunkData,
      }: {
        uploadId: string;
        chunkIndex: number;
        chunkData: Blob;
      }) => ({
        url: `/upgrade/chunk-upload/${uploadId}`,
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Chunk-Index": String(chunkIndex),
        },
        body: chunkData,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
    }),

    // Process upload (assemble chunks, validate, organize)
    processUpload: builder.mutation({
      query: (uploadId: string) => ({
        url: `/upgrade/process-upload/${uploadId}`,
        method: "POST",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Cancel upload
    cancelUpload: builder.mutation({
      query: (uploadId: string) => ({
        url: `/upgrade/cancel-upload/${uploadId}`,
        method: "POST",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Trigger upgrade (uses bundleId for fast primary key lookup)
    triggerUpgrade: builder.mutation({
      query: (body: { bundleId: string }) => ({
        url: `/upgrade/trigger-upgrade`,
        method: "POST",
        body,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Skip upgrade (when user clicks Reset after successful upload)
    skipUpgrade: builder.mutation({
      query: (body: { bundleId: string }) => ({
        url: `/upgrade/skip`,
        method: "POST",
        body,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Get multicast status (worker binary distribution progress)
    getMulticastStatus: builder.query<MulticastStatusResponse, string>({
      query: (bundleId: string) => `/upgrade/multicast/${bundleId}`,
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
    }),

    // Get worker upgrade execution status
    getExecutionStatus: builder.query<ExecutionStatusResponse, string>({
      query: (bundleId: string) => `/upgrade/execute/${bundleId}`,
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
    }),

    // Reset upgrade — terminate workflows, reset workers and bundle state
    resetUpgrade: builder.mutation({
      query: (bundleId: string) => ({
        url: `/upgrade/reset/${bundleId}`,
        method: "POST",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Save or clear stopped job IDs on the bundle record (persists across CP restart)
    saveStoppedJobIds: builder.mutation<
      { success: boolean },
      { bundleId: string; deactivatedConfigIds: string[]; stoppedRunIds: string[] }
    >({
      query: ({ bundleId, deactivatedConfigIds, stoppedRunIds }) => ({
        url: `/upgrade/bundle/${bundleId}/stopped-job-ids`,
        method: "PATCH",
        body: { deactivatedConfigIds, stoppedRunIds },
      }),
      transformResponse: (response: any) => {
        return response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),
  }),
});

export const {
  useGetLatestUploadStatusQuery,
  useInitUploadMutation,
  useUploadChunkMutation,
  useProcessUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
  useSkipUpgradeMutation,
  useLazyGetMulticastStatusQuery,
  useLazyGetExecutionStatusQuery,
  useResetUpgradeMutation,
  useSaveStoppedJobIdsMutation,
} = upgradeApi;