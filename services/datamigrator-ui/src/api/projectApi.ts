import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const projectApi = createApi({
  reducerPath: "projectApi",
  tagTypes: ["ALL_PROJECTS"],

  baseQuery: fetchBaseQuery({
    baseUrl: window?.env?.VITE_ADMIN_SERVICE_URL || import.meta.env.VITE_ADMIN_SERVICE_URL,
    prepareHeaders,
  }),

  endpoints: (builder) => ({
    getAllProjects: builder.query({
      query: (accountId) => {
        return `/projects/accounts/${accountId}/projects?page=1&limit=1000`;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || [];
      },
      providesTags: ["ALL_PROJECTS"],
    }),

    createProject: builder.mutation({
      query: (body) => ({
        url: `/projects`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["ALL_PROJECTS"],
    }),

    updateProject: builder.mutation({
      query: ({ body, project_id }) => ({
        url: `/projects/${project_id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["ALL_PROJECTS"],
    }),

    deleteProjects: builder.mutation({
      query: (id) => ({
        url: `/projects/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["ALL_PROJECTS"],
    }),
  }),
});

export const {
  useCreateProjectMutation,
  useUpdateProjectMutation,
  useGetAllProjectsQuery,
  useLazyGetAllProjectsQuery,
  useDeleteProjectsMutation,
} = projectApi;
