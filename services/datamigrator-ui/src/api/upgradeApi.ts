import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export interface LatestUploadStatusResponse {
  hasUpload: boolean;
  uploadStatus?: string;
  upgradeSuccess?: boolean;
  fileName?: string;
  filePath?: string;
  fileSize?: number;
  version?: string;
  uploadCompletedAt?: string;
  upgradeCompletedAt?: string;
  showUploadUI: boolean;
  showUpgradeUI: boolean;
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
      query: (body: { fileName: string; fileSize: number; checksum: string }) => ({
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
        url: `/upgrade/chunk/${uploadId}`,
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

    // Finalize upload (assemble chunks)
    finalizeUpload: builder.mutation({
      query: (uploadId: string) => ({
        url: `/upgrade/finalize/${uploadId}`,
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
        url: `/upgrade/cancel/${uploadId}`,
        method: "DELETE",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Trigger upgrade
    triggerUpgrade: builder.mutation({
      query: (body: { filePath: string; fileName?: string }) => ({
        url: `/upgrade/trigger`,
        method: "POST",
        body,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
      invalidatesTags: ["UPLOAD_STATUS"],
    }),

    // Cleanup upgrade directory
    cleanupUpgrade: builder.mutation<{ success: boolean; message: string }, void>({
      query: () => ({
        url: "/upgrade/cleanup",
        method: "DELETE",
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
  useFinalizeUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
  useCleanupUpgradeMutation,
} = upgradeApi;