import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export interface EulaStatusResponse {
  eulaAccepted: boolean;
  version: string;
  mustAccept: boolean;
  content: string;
}

export const eulaApi = createApi({
  reducerPath: "eulaApi",
  tagTypes: ["EULA_STATUS"],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_ADMIN_SERVICE_URL ||
      import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getEulaStatus: builder.query<EulaStatusResponse, void>({
      query: () => "/eula/status",
      transformResponse: (response: any) =>
        response?.data?.items || response?.data || response,
      providesTags: ["EULA_STATUS"],
    }),
    acceptEula: builder.mutation<{ accepted: boolean; version: string }, void>({
      query: () => ({
        url: "/eula/accept",
        method: "POST",
      }),
      transformResponse: (response: any) =>
        response?.data?.items || response?.data || response,
      invalidatesTags: ["EULA_STATUS"],
    }),
  }),
});

export const { useLazyGetEulaStatusQuery, useAcceptEulaMutation } = eulaApi;
