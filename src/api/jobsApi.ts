import {
  JOB_ACTION_STATUS_ENUM,
  JOB_CONFIG_STATUS_ENUM,
} from "@/types/app.type";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";
import { reportApi } from "./reportApi";
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
  ],
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_JOBS_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getJobConfigs: builder.query({
      query: ({ projectId }) => `jobs?projectId=${projectId}`,
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
      providesTags: ["JOB_CONFIG_DETAILS"],
    }),

    getJobRuns: builder.query({
      query: ({ projectId }) => `job-run?projectId=${projectId}`,
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
      }) => {
        let url = `tasks?jobRunId=${jobRunId}&limit=${limit}&page=${page}`;

        taskType.forEach((value: string) => {
          url += `&taskType=${value}`;
        });

        status.forEach((value: string) => {
          url += `&status=${value}`;
        });

        if (sort) {
          url += `&sort=${sort}&order=${order}`;
        }
        return url;
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
    }),

    getAllFileServersWithVolume: builder.query({
      query: ({ projectId }) => ({
        url: `jobs/project/${projectId}`,
        method: "GET",
      }),
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
        query: ({ projectId }) => `jobs/speedtest?projectId=${projectId}`,
        providesTags: ["SPEED_TEST_JOBS"],
      }
    ),

    getSpeedTestDetails: builder.query<SpeedTestDetailsType, string>({
      query: (jobRunId) => `jobs/speedtest/${jobRunId}`,
    }),

    createFileServerForSpeedTest: builder.mutation({
      query: (body) => ({
        url: `jobs/speed-test`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["SPEED_TEST_JOBS"],
    }),

    getJobRunErrors: builder.mutation({
      query: (queryParams) => ({
        url: `job-run/{jobRunId}/errors?${queryParams}`,
        method: "GET",
      }),
      invalidatesTags: ["SPEED_TEST_JOBS"],
    }),

    getJobRunErrorsOverview: builder.query({
      query: ({ jobRunId }) => ({
        url: `job-run/${jobRunId}/errors/overview`,
        method: "GET",
      }),
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
  useLazyGetJobTasksQuery,
  useBulkMigrateMutation,
  usePrecheckMutation,
  useLazyGetAllFileServersWithVolumeQuery,
  useBulkCutOverMutation,
  useLazyDownloadTemplateQuery,
  useConfirmCutOverMutation,
  useGetSpeedTestJobsQuery,
  useGetSpeedTestDetailsQuery,
  useCreateFileServerForSpeedTestMutation,
  useGetJobRunErrorsMutation,
  useLazyGetJobRunErrorsOverviewQuery,
} = jobsApi;
