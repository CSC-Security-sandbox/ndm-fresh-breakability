import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

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

    // Finalize upload (assemble chunks + verify checksum)
    finalizeUpload: builder.mutation({
      query: (uploadId: string) => ({
        url: `/upgrade/finalize/${uploadId}`,
        method: "POST",
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
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
    }),

    // Trigger upgrade (called after job check passes)
    triggerUpgrade: builder.mutation({
      query: (body: { filePath: string; fileName?: string }) => ({
        url: `/upgrade/trigger`,
        method: "POST",
        body,
      }),
      transformResponse: (response: any) => {
        return response?.data?.items || response?.data || response;
      },
    }),
  }),
});

export const {
  useInitUploadMutation,
  useUploadChunkMutation,
  useFinalizeUploadMutation,
  useCancelUploadMutation,
  useTriggerUpgradeMutation,
} = upgradeApi;