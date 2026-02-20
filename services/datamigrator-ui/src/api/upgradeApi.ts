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
  isUpgradeInProgress?: boolean;
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
      query: () => "/upgrade/latest-status",
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
        url: `/upgrade/chunk_upload/${uploadId}`,
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
        url: `/upgrade/process_upload/${uploadId}`,
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
        url: `/upgrade/cancel_upload/${uploadId}`,
        method: "DELETE",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Trigger upgrade (uses bundleId for fast primary key lookup)
    triggerUpgrade: builder.mutation({
      query: (body: { bundleId: string }) => ({
        url: `/upgrade/trigger`,
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
} = upgradeApi;