import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const workerManagerApi = createApi({
  reducerPath: "workerManagerApi",
  baseQuery: fetchBaseQuery({
    baseUrl: window?.env?.VITE_CONFIG_SERVICE_URL || import.meta.env.VITE_CONFIG_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    validateConnection: builder.mutation({
      query: (body) => ({
        url: `/work-manager/validate-connection`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),

    checkConnectionResp: builder.query({
      query: ({ id }) => ({
        url: `/work-manager/workflow/details/${id}`,
        method: "GET",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
    }),
  }),
});

export const {
  useValidateConnectionMutation,
  useLazyCheckConnectionRespQuery,
} = workerManagerApi;
