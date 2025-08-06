/* eslint-disable @typescript-eslint/no-explicit-any */
import { GetAllWorkersApiType } from "@/types/app.type";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const workersApi = createApi({
  reducerPath: "workersApi",
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_WORKERS_SERVICE_URL ||
      import.meta.env.VITE_WORKERS_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getAllWorkers: builder.query({
      query: (url) => url,
      
      // THIS IS RESP MODIFICATION DUE TO BLUEXP SELECT WORKS ON ID. ON VALIDATE CONNECTION
      transformResponse: (response: any) => {
        const workers = response?.data?.items || response?.data || [];
        return workers?.map((worker: GetAllWorkersApiType) => {
          return {
            ...worker,
            id: worker?.workerId,
          };
        });
      },
    }),

    refetchExportPaths: builder.query({
      query: ({ fileServerId }) => ({
        url: `/event/refetch-paths/${fileServerId}`,
        method: "GET",
      }),
    }),
  }),
});

export const {
  useGetAllWorkersQuery,
  useLazyGetAllWorkersQuery,
  useLazyRefetchExportPathsQuery,
} = workersApi;
