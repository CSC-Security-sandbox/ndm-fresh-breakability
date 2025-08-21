import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { RootStateType } from "src/store/store";

export const permissionApi = createApi({
  reducerPath: "permissionApi",
  tagTypes: ["PERMISSIONS"],
  baseQuery: fetchBaseQuery({
    baseUrl: window?.env?.VITE_ADMIN_SERVICE_URL || import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as RootStateType;
      const token = state.authSlice?.accessToken;
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
      transformResponse: (response) => {
        return {
          data: response?.data?.items || response?.data || [],
          id: response?.data?.id || "",
        }
      },
      providesTags: ["PERMISSIONS"],
    }),
  }),
});

export const { useGetUserPermissionsQuery, useLazyGetUserPermissionsQuery } =
  permissionApi;
