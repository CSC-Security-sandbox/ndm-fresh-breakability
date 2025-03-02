import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import Cookies from "js-cookie";

export const permissionApi = createApi({
  reducerPath: "permissionApi",
  tagTypes: ["PERMISSIONS"],
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_PUBLIC_ADMIN_SERVICE_URL,
    prepareHeaders: (headers) => {
      const token = Cookies.get("access_token");
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  endpoints: (builder) => ({
    getUserPermissions: builder.query({
      query: () => ({
        url: `/user-permissions`,
        method: "GET",
      }),
      providesTags: ["PERMISSIONS"],
    }),
  }),
});

export const { useGetUserPermissionsQuery, useLazyGetUserPermissionsQuery } =
  permissionApi;
