import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const workerManagerApi = createApi({
  reducerPath: "workerManagerApi",
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_PUBLIC_CONFIG_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    validateConnection: builder.mutation({
      query: (body) => ({
        url: `/work-manager/validate-connection`,
        method: "POST",
        body,
      }),
    }),

    checkConnectionResp: builder.query({
      query: ({ id }) => ({
        url: `/work-manager/workflow/details/${id}`,
        method: "GET",
      }),
    }),
  }),
});

export const {
  useValidateConnectionMutation,
  useLazyCheckConnectionRespQuery,
} = workerManagerApi;
