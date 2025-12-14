import {
  JOB_ACTION_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
} from "@/types/app.type";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders, structuredErrorResponse } from "@api/api.utils";
import { reportApi } from "@api/reportApi";
import { SpeedTestJobsType } from "@modules/speed-test/types/speed-test.types";
import { SpeedTestDetailsType } from "@modules/speed-test/types/speed-test-details.types";

export const jobsApi = createApi({
  reducerPath: "jobsApi",
  tagTypes: [
    "ALL_JOB_CONFIGS",
    "ALL_JOB_RUNS",
    "JOB_CONFIG_DETAILS",
    "ALL_MIGRATION_PATHS",
    "SPEED_TEST_JOBS",
    "JOB_IDENTITY_MAPPINGS",
  ],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_JOBS_SERVICE_URL ||
      import.meta.env.VITE_JOBS_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getJobConfigs: builder.query({
      query: ({ projectId }) => `jobs?projectId=${projectId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
      providesTags: ["ALL_JOB_CONFIGS"],
    }),

    updateJobStatus: builder.mutation({
      query: ({
        id,
        status,
      }: {
        id: string;
        status: JOB_CONFIG_STATUS_ENUM;
      }) => ({
        url: `jobs/${id}`,
        method: "PATCH",
        body: {
          status,
        },
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
      transformErrorResponse: structuredErrorResponse,
      invalidatesTags: ["ALL_JOB_CONFIGS", "JOB_CONFIG_DETAILS"],
    }),

    updateJobRunStatus: builder.mutation({
      query: ({
        ids,
        status,
      }: {
        ids: string[];
        status: JOB_ACTION_STATUS_ENUM;
      }) => ({
        url: `job-run/action`,
        method: "PUT",
        body: {
          action: status,
          jobRuns: ids,
        },
      }),
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        await queryFulfilled;
        dispatch(reportApi.util.invalidateTags(["JOB_RUN_DETAILS"]));
      },
      invalidatesTags: ["ALL_JOB_RUNS", "JOB_CONFIG_DETAILS"],
    }),

    jobAdhocRun: builder.mutation({
      query: ({ jobConfigId }) => ({
        url: "job-run/ad-hoc",
        method: "POST",
        body: {
          jobConfigId,
        },
      }),
    }),

    getJobConfigDetails: builder.query({
      query: ({ jobConfigId }) => `jobs/${jobConfigId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || {};
      },
      providesTags: ["JOB_CONFIG_DETAILS"],
    }),

    getJobRuns: builder.query({
      query: ({ projectId }) => `job-run?projectId=${projectId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
      providesTags: ["ALL_JOB_RUNS"],
    }),

    bulkDiscovery: builder.mutation({
      query: (body) => ({
        url: `jobs/bulk-discovery`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["ALL_JOB_CONFIGS"],
    }),

    getJobTasks: builder.query({
      query: ({
        jobRunId,
        page = 1,
        taskType = [],
        status = [],
        limit = 10,
        sort,
        order = "asc",
        workerId = [],
      }) => {
        let url = `tasks?jobRunId=${jobRunId}&limit=${limit}&page=${page}`;

        taskType.forEach((value: string) => {
          url += `&taskType=${value}`;
        });

        status.forEach((value: string) => {
          url += `&status=${value}`;
        });

        workerId.forEach((value: string) => {
          url += `&workerId=${value}`;
        });

        if (sort) {
          url += `&sort=${sort}&order=${order}`;
        }
        return url;
      },
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
    }),

    bulkMigrate: builder.mutation({
      query: (body) => ({
        url: "jobs/bulk-migrate",
        method: "POST",
        body,
      }),
      invalidatesTags: ["ALL_JOB_CONFIGS"],
    }),

    precheck: builder.mutation({
      query: (body) => ({
        url: "jobs/precheck",
        method: "POST",
        body,
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
      transformErrorResponse: structuredErrorResponse,
    }),

    getAllFileServersWithVolume: builder.query({
      query: ({ projectId }) => ({
        url: `jobs/project/${projectId}`,
        method: "GET",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
    }),

    bulkCutOver: builder.mutation({
      query: (body) => ({
        url: `jobs/bulk-cutover`,
        method: "POST",
        body,
      }),

      invalidatesTags: [
        "ALL_JOB_CONFIGS",
        "ALL_JOB_RUNS",
        "JOB_CONFIG_DETAILS",
        "ALL_MIGRATION_PATHS",
      ],
    }),

    downloadTemplate: builder.query({
      query: (type) => ({
        url: `jobs/download-template/${type}`,
        responseHandler: async (response) => response.blob(),
      }),
    }),

    confirmCutOver: builder.mutation({
      query: (body) => ({
        url: "job-run/cutover/approve",
        method: "PUT",
        body,
      }),
      invalidatesTags: ["ALL_JOB_RUNS"],
    }),

    //Speed Test
    getSpeedTestJobs: builder.query<SpeedTestJobsType[], { projectId: string }>(
      {
        query: ({ projectId }) => `jobs/speed-test?projectId=${projectId}`,
        providesTags: ["SPEED_TEST_JOBS"],
      }
    ),
    getSpeedTestDetails: builder.query<SpeedTestDetailsType, string>({
      query: (jobRunId) => `jobs/speed-test/${jobRunId}`,
    }),

    createFileServerForSpeedTest: builder.mutation({
      query: (body) => ({
        url: `jobs/speed-test`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["SPEED_TEST_JOBS"],
    }),

    getJobRunErrors: builder.query({
      query: (queryParams) => `job-run/errors?${queryParams}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),

    getJobRunErrorsOverview: builder.query({
      query: ({ jobRunId }) => ({
        url: `job-run/${jobRunId}/errors/overview`,
        method: "GET",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      },
    }),

    getNoticeBoardDetails: builder.query({
      query: ({ projectId }) => ({
        url: `jobs/notice-board/${projectId}`,
        method: "GET",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response;
      },
    }),

    getFileServerWorkers: builder.query({
      query: ({ jobRunId }) => ({
        url: `workers/job-run/${jobRunId}`,
        method: "GET",
      }),
    }),

    deleteJobConfig: builder.mutation({
      query: (id: string) => ({
        url: `jobs/${id}`,
        method: "DELETE",
      }),
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response;
      },
      transformErrorResponse: structuredErrorResponse,
      invalidatesTags: ["ALL_JOB_CONFIGS", "JOB_CONFIG_DETAILS"],
    }),

    getJobIdentityMappings: builder.query({
      query: (jobConfigId: string) => ({
        url: `jobs/${jobConfigId}/mappings`,
        method: 'GET',
      }),
      transformResponse: (response) => {
        return response?.data || response;
      },
      providesTags: (result, error, jobConfigId) => [
        { type: 'JOB_IDENTITY_MAPPINGS', id: jobConfigId }
      ],
    }),

    updateDiscoveryJobConfig: builder.mutation({
      query: ({ jobConfigId, updateData }: { jobConfigId: string; updateData: any }) => ({
        url: `jobs/${jobConfigId}/discovery-config`,
        method: 'PUT',
        body: updateData,
      }),
      transformResponse: (response) => {
        return response?.data || response;
      },
      transformErrorResponse: structuredErrorResponse,
      invalidatesTags: ['JOB_CONFIG_DETAILS', 'ALL_JOB_CONFIGS'],
    }),

    updateMigrationJobConfig: builder.mutation({
      query: ({ jobConfigId, updateData }: { jobConfigId: string; updateData: any }) => ({
        url: `jobs/${jobConfigId}/migration-config`,
        method: 'PUT',
        body: updateData,
      }),
      transformResponse: (response) => {
        return response?.data || response;
      },
      transformErrorResponse: structuredErrorResponse,
      invalidatesTags: (result, error, { jobConfigId }) => [
        'JOB_CONFIG_DETAILS',
        'ALL_JOB_CONFIGS',
        { type: 'JOB_IDENTITY_MAPPINGS', id: jobConfigId },
      ],
    }),
  }),
});

export const {
  useGetJobConfigsQuery,
  useGetJobConfigDetailsQuery,
  useLazyGetJobConfigDetailsQuery,
  useGetJobRunsQuery,
  useLazyGetJobRunsQuery,
  useBulkDiscoveryMutation,
  useUpdateJobStatusMutation,
  useUpdateJobRunStatusMutation,
  useJobAdhocRunMutation,
  useGetJobTasksQuery,
  useBulkMigrateMutation,
  usePrecheckMutation,
  useLazyGetAllFileServersWithVolumeQuery,
  useBulkCutOverMutation,
  useLazyDownloadTemplateQuery,
  useConfirmCutOverMutation,
  useGetSpeedTestJobsQuery,
  useGetSpeedTestDetailsQuery,
  useCreateFileServerForSpeedTestMutation,
  useGetJobRunErrorsQuery,
  useLazyGetJobRunErrorsOverviewQuery,
  useLazyGetNoticeBoardDetailsQuery,
  useGetFileServerWorkersQuery,
  useDeleteJobConfigMutation,
  useGetJobIdentityMappingsQuery,
  useLazyGetJobIdentityMappingsQuery,
  useUpdateDiscoveryJobConfigMutation,
  useUpdateMigrationJobConfigMutation,
} = jobsApi;
