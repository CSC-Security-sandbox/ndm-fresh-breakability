import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const configApi = createApi({
  reducerPath: "configApi",
  tagTypes: ["GET_ALL_FILE_SERVERS", "GET_ALL_AGENTS", "GET_FILE_SERVER_BY_ID"],
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_CONFIG_SERVICE_URL,
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
      invalidatesTags: ["GET_ALL_FILE_SERVERS"],
    }),

    // GET FILE SERVER
    getAllFileServersOfProject: builder.query({
      query: ({ projectId }) => {
        return `/servers?projectId=${projectId}`;
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
      invalidatesTags: ["GET_ALL_FILE_SERVERS"],
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
    }),

    refetchConfigExportPaths: builder.query({
      query: ({ fileServerId }) => ({
        url: `/servers/refresh/${fileServerId}`,
        method: "GET",
      }),
    }),

    getAllCutOverPaths: builder.query({
      query: ({ fileServerId }) => `/servers/cutover/${fileServerId}`,
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
  useLazyGetFileServerByIdQuery,
  useGetAllCutOverPathsQuery,
  useLazyGetAllCutOverPathsQuery,
} = configApi;
