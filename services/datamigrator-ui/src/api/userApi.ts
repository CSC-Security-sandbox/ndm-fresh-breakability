import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import Cookies from "js-cookie";

export const usersApi = createApi({
  reducerPath: "usersApi",
  tagTypes: [
    "ALL_USERS",
    "ALL_ROLES",
    "USER_ROLES",
    "CREATE_USER",
    "MY_DETAILS",
    "GET_SMTP"
  ],
  baseQuery: fetchBaseQuery({
    baseUrl: window?.env?.VITE_ADMIN_SERVICE_URL || import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders: (headers, { endpoint }) => {
      const token = Cookies.get("access_token");
      const projectId = localStorage.getItem("selected_project_id");
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      if (
        endpoint !== "logoutUser" &&
        projectId &&
        endpoint !== "refreshUserToken"
      ) {
        headers.set("projectId", `${projectId}`);
      }

      return headers;
    },
  }),
  endpoints: (builder) => ({
    getAllUsers: builder.query({
      query: () => {
        return `/users?limit=${window?.env?.VITE_API_LIMIT || import.meta.env.VITE_API_LIMIT}`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["ALL_USERS"],
    }),

    getAllUsersWithRoles: builder.query({
      query: () => {
        return `/user-roles/grouping?limit=${window?.env?.VITE_API_LIMIT || import.meta.env.VITE_API_LIMIT}`;
      },
      providesTags: ["ALL_USERS"],
    }),

    getAllRoles: builder.query({
      query: () => {
        return `/roles`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["ALL_ROLES"],
    }),

    getUserDetails: builder.query({
      query: ({ userId }) => {
        return `/users/${userId}`;
      },
      providesTags: ["MY_DETAILS"],
    }),

    getAllUserRoles: builder.query({
      query: ({ project_id }) => {
        return `/user-roles?project_id=${project_id}`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["USER_ROLES"],
    }),

    createUser: builder.mutation({
      query: (body) => ({
        url: `/create-user`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return {
          data: response?.data?.items || response?.data || {},
          message: response?.message || "",
        };
      },
      transformErrorResponse: (error: any) => {
        return error?.data?.error || error;
      },
      invalidatesTags: ["ALL_USERS"],
    }),

    resetPassword: builder.mutation({
      query: (body) => ({
        url: `/reset-password`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || {};
      },
      transformErrorResponse: (error: any) => {
        return error?.data?.error || error;
      },
    }),

    updateUserStatus: builder.mutation({
      query: (body) => ({
        url: `/user-status`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return {
          data: response?.data?.items || response?.data || {},
          message: response?.message || "",
        };
      },
      transformErrorResponse: (error: any) => {
        return error?.data?.error || error;
      },
      invalidatesTags: ["ALL_USERS"],
    }),

    associateUser: builder.mutation({
      query: (body) => ({
        url: `/user-roles`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["USER_ROLES", "ALL_USERS"],
    }),

    associateUserBatch: builder.mutation({
      query: (body) => ({
        url: `/user-roles/batch`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["USER_ROLES", "ALL_USERS"],
    }),

    deleteUserRoles: builder.mutation({
      query: (id) => ({
        url: `/user-roles/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["USER_ROLES"],
    }),

    logoutUser: builder.mutation({
      query: (body) => ({
        url: `${window?.env?.VITE_KEYCLOAK_HOST || import.meta.env.VITE_KEYCLOAK_HOST}/realms/${
          window?.env?.VITE_KEYCLOAK_REALM || import.meta.env.VITE_KEYCLOAK_REALM
        }/protocol/openid-connect/logout`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body).toString(),
      }),
    }),

    refreshUserToken: builder.mutation({
      query: (body) => ({
        url: `${window?.env?.VITE_KEYCLOAK_HOST || import.meta.env.VITE_KEYCLOAK_HOST}/realms/${
          window?.env?.VITE_KEYCLOAK_REALM || import.meta.env.VITE_KEYCLOAK_REALM
        }/protocol/openid-connect/token`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body).toString(),
      }),
    }),

    generateSecretForWorker: builder.query({
      query: (body) => ({
        url: `/worker-registration`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || {};
      },
    }),

    //smtp related api's
    getSmtpDetails: builder.query({
      query: () => {
        return `/setting`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["GET_SMTP"],
    }),

    createSmtp: builder.mutation({
      query: (body) => ({
        url: `/setting`,
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return {
          data: response?.data?.items || response?.data || {},
          message: response?.message || "",
        };
      },
      transformErrorResponse: (error: any) => {
        return error?.data?.error || error;
      },
      invalidatesTags: ["GET_SMTP"],
    }),

    updateSmtpData: builder.mutation({
      query: (body) => ({
        url: `/setting`,
        method: "PATCH",
        body,
      }),
      transformResponse: (response) => {
        return {
          data: response?.data?.items || response?.data || {},
          message: response?.message || "",
        };
      },
      transformErrorResponse: (error: any) => {
        return error?.data?.error || error;
      },
      invalidatesTags: ["GET_SMTP"],
    }),
  }),
});

export const {
  useRefreshUserTokenMutation,
  useLogoutUserMutation,
  useGetAllUsersQuery,
  useGetAllUsersWithRolesQuery,
  useGetUserDetailsQuery,
  useGetAllUserRolesQuery,
  useLazyGetAllUserRolesQuery,
  useGetAllRolesQuery,
  useDeleteUserRolesMutation,
  useAssociateUserMutation,
  useCreateUserMutation,
  useUpdateUserStatusMutation,
  useAssociateUserBatchMutation,
  useResetPasswordMutation,
  useLazyGenerateSecretForWorkerQuery,
  useGetSmtpDetailsQuery,
  useCreateSmtpMutation,
  useUpdateSmtpDataMutation,
} = usersApi;
