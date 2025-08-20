/* eslint-disable @typescript-eslint/no-explicit-any */
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

const prepareHeaders = (headers: any, { getState }: any) => {
  const state = getState();
  const token = state.authSlice?.accessToken;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

export const accountApi = createApi({
  reducerPath: "accountApi",
  tagTypes: ["ALL_ACCOUNTS"],

  baseQuery: fetchBaseQuery({
    baseUrl: window?.env?.VITE_ADMIN_SERVICE_URL || import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders: prepareHeaders,
  }),
  endpoints: (builder) => ({
    getAllAccounts: builder.query({
      query: () => {
        return "/accounts";
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["ALL_ACCOUNTS"],
    }),

    createAccount: builder.mutation({
      query: (body) => ({
        url: `/account`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["ALL_ACCOUNTS"],
    }),
  }),
});

export const {
  useCreateAccountMutation,
  useGetAllAccountsQuery,
  useLazyGetAllAccountsQuery,
} = accountApi;
