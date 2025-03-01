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
  ],
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_PUBLIC_ADMIN_SERVICE_URL,
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
        return `/users?limit=${import.meta.env.VITE_PUBLIC_API_LIMIT}`;
      },
      providesTags: ["ALL_USERS"],
    }),

    getAllUsersWithRoles: builder.query({
      query: () => {
        return `/user-roles/grouping?limit=${
          import.meta.env.VITE_PUBLIC_API_LIMIT
        }`;
      },
      providesTags: ["ALL_USERS"],
    }),

    getAllRoles: builder.query({
      query: () => {
        return `/roles`;
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
      providesTags: ["USER_ROLES"],
    }),

    createUser: builder.mutation({
      query: (body) => ({
        url: `/create-user`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["ALL_USERS"],
    }),

    resetPassword: builder.mutation({
      query: (body) => ({
        url: `/reset-password`,
        method: "POST",
        body,
      }),
    }),

    updateUserStatus: builder.mutation({
      query: (body) => ({
        url: `/user-status`,
        method: "POST",
        body,
      }),
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
        url: `${import.meta.env.VITE_PUBLIC_KEYCLOAK_HOST}/realms/${
          import.meta.env.VITE_PUBLIC_KEYCLOAK_REALM
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
        url: `${import.meta.env.VITE_PUBLIC_KEYCLOAK_HOST}/realms/${
          import.meta.env.VITE_PUBLIC_KEYCLOAK_REALM
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
} = usersApi;
