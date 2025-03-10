import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";


export const smtpApi = createApi({
  reducerPath: "smtpApi",
  tagTypes: ["SMTP"],

  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_REPORTS_SERVICE_URL,
    prepareHeaders,
  }),

  endpoints: (builder) => ({
    getSmtpDetails: builder.query({
      query: () => {
        return `/setting`;
      },
      providesTags: ["SMTP"],
    }),

    createSmtp: builder.mutation({
      query: (body) => ({
        url: `/setting`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["SMTP"],
    }),
  }),
});

export const {
  useGetSmtpDetailsQuery,
  useCreateSmtpMutation,
} = smtpApi;
