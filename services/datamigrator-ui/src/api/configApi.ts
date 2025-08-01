import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";
import { SpeedTestConfigType } from "@modules/speed-test/types/speed-test.types";
import {
  UploadedFilePropsType,
  UploadExportPathSourceFileProps,
} from "@/modules/storage-servers/file-server/file-server-overview/bulk-manual-upload/bulk-manual-upload-file.types";

export const configApi = createApi({
  reducerPath: "configApi",
  tagTypes: ["GET_ALL_FILE_SERVERS", "GET_ALL_AGENTS", "GET_FILE_SERVER_BY_ID"],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_CONFIG_SERVICE_URL ||
      import.meta.env.VITE_CONFIG_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    // CREATE FILE SERVER
    createFileServer: builder.mutation({
      query: (body) => ({
        url: `/servers`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || {};
      },
      invalidatesTags: ["GET_ALL_FILE_SERVERS"],
    }),

    // GET FILE SERVER
    getAllFileServersOfProject: builder.query({
      query: ({ projectId }) => {
        return `/servers?projectId=${projectId}`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || {};
      },
      providesTags: ["GET_ALL_FILE_SERVERS"],
    }),

    // UPDATE FILE SERVER
    updateFileServer: builder.mutation({
      query: ({ id, body }) => ({
        url: `servers/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["GET_ALL_FILE_SERVERS", "GET_FILE_SERVER_BY_ID"],
    }),

    // DELETE FILE SERVER
    deleteFileServer: builder.mutation({
      query: ({ id }) => ({
        url: `/servers/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["GET_ALL_FILE_SERVERS"],
    }),

    getFileServerById: builder.query({
      query: ({ fileServerId }) => ({
        url: `/servers/${fileServerId}`,
        method: "GET",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || {};
      },
      providesTags: ["GET_FILE_SERVER_BY_ID"],
    }),

    refetchConfigExportPaths: builder.query({
      query: ({ fileServerId }) => ({
        url: `/servers/refresh/${fileServerId}`,
        method: "GET",
      }),
    }),

    getAllCutOverPaths: builder.query({
      query: ({ fileServerId }) => `/servers/cutover/${fileServerId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
    }),

    getSpeedTestFileServers: builder.query<SpeedTestConfigType[], void>({
      query: () => "servers/file-servers",
    }),

    getUniqueFileServerNames: builder.query({
      query: ({ projectId, configName }) =>
        `servers/check-unique?projectId=${projectId}&configName=${configName}`,
    }),

    downloadExportPathSourceTemplate: builder.query<
      Blob,
      Record<string, string>
    >({
      query: ({ type, fileServerId }) => ({
        url: `paths-upload/download/${type}/${fileServerId}`,
        responseHandler: async (response) => {
          if (!response.ok) {
            const errorText = await response.text();
            return JSON.parse(errorText);
          }
          return response.blob();
        },
      }),
    }),

    uploadExportPathSourceFile: builder.mutation<
      UploadedFilePropsType,
      UploadExportPathSourceFileProps
    >({
      query: ({ fileServerId, body }) => ({
        url: `paths-upload/${fileServerId}`,
        method: "POST",
        body,
      }),
    }),

    submitExportPathSourceFile: builder.mutation<void, { uploadId: string }>({
      query: ({ uploadId }) => ({
        url: `paths-upload/confirm/${uploadId}`,
        method: "POST",
      }),
      invalidatesTags: ["GET_FILE_SERVER_BY_ID"],
    }),
  }),
});

export const {
  useLazyRefetchConfigExportPathsQuery,
  useGetAllFileServersOfProjectQuery,
  useLazyGetAllFileServersOfProjectQuery,
  useCreateFileServerMutation,
  useDeleteFileServerMutation,
  useUpdateFileServerMutation,
  useGetFileServerByIdQuery,
  useLazyGetFileServerByIdQuery,
  useGetAllCutOverPathsQuery,
  useLazyGetAllCutOverPathsQuery,
  useGetSpeedTestFileServersQuery,
  useLazyGetUniqueFileServerNamesQuery,
  useLazyDownloadExportPathSourceTemplateQuery,
  useUploadExportPathSourceFileMutation,
  useSubmitExportPathSourceFileMutation,
} = configApi;
