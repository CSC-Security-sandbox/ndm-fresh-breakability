/* eslint-disable @typescript-eslint/no-explicit-any */
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import Cookies from "js-cookie";

const prepareHeaders = (headers: any) => {
  const token = Cookies.get("token");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

export const accountApi = createApi({
  reducerPath: "accountApi",
  tagTypes: ["ALL_ACCOUNTS"],

  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_PUBLIC_ADMIN_SERVICE_URL,
    prepareHeaders: prepareHeaders,
  }),
  endpoints: (builder) => ({
    getAllAccounts: builder.query({
      query: () => {
        return "/accounts";
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
