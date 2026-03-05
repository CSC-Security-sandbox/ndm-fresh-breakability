import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export const reportApi = createApi({
  reducerPath: "reportApi",
  tagTypes: ["JOB_RUN_DETAILS"],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_REPORTS_SERVICE_URL ||
      import.meta.env.VITE_REPORTS_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    getJobOverview: builder.query({
      query: ({ jobId }) => `overview?jobConfigId=${jobId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),
    getProjectOverview: builder.query({
      query: ({ projectId }) => `overview?projectId=${projectId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),
    getFileOverview: builder.query({
      query: ({ fileServerId }) => `overview?fileServerId=${fileServerId}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),
    downloadReports: builder.mutation({
      query: (body) => ({
        url: "inventory/download",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        responseHandler: (response) => response.blob(),
      }),
    }),
    getPdfReport: builder.mutation({
      query: (body) => ({
        url: "pdf/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
        responseHandler: (response) => response.blob(),
      }),
    }),
    getJobRunDetails: builder.query({
      query: ({ jobRunId }) => `job-run/${jobRunId}`,
      providesTags: ["JOB_RUN_DETAILS"],
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),
    getReportData: builder.query({
      query: (payload) =>
        `job-run/job-report?jobRunId=${payload.jobRunId}&reportType=${payload.reportType}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),

    downloadErrorLogsCSV: builder.query({
      query: ({ type, id }) => ({
        url: `job-run/download-error-csv/${type}/${id}`,
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        responseHandler: (response) => response.blob(),
      }),
    }),

    generateErrorLogs: builder.query({
      query: ({ type, id }) => `job-run/generate-error-csv/${type}/${id}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),

    isErrorLogsCsvReady: builder.query({
      query: ({ type, id }) => `job-run/is-error-csv-ready/${type}/${id}`,
      transformResponse: (response) => {
        return response?.data?.items || response?.data || response || [];
      }
    }),
    
    startConsolidatedDiscoveryReport: builder.mutation({
      query: ({ fileServerId, configName, format }) => ({
        url: `reports/consolidated/start`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: { fileServerId, configName, format },
      }),
      transformResponse: (response) => {
        return response?.data || response;
      }
    }),

    getConsolidatedReportStatus: builder.query({
      query: ({ workflowId }) => `reports/consolidated/status/${workflowId}`,
      transformResponse: (response) => {
        return response?.data || response;
      }
    }),

    getConsolidatedReportStatusByFileServer: builder.query({
      query: ({ fileServerId }) => `reports/consolidated/status/fileserver/${fileServerId}`,
      transformResponse: (response) => {
        return response?.data?.items || response;
      }
    }),

    downloadConsolidatedReport: builder.query({
      query: ({ fileServerId }) => ({
        url: `reports/consolidated/download/${fileServerId}`,
        method: "GET",
        responseHandler: (response) => response.blob(),
      }),
    }),
  }),
});

export const {
  useGetPdfReportMutation,
  useGetReportDataQuery,
  useGetJobOverviewQuery,
  useGetFileOverviewQuery,
  useLazyGetFileOverviewQuery,
  useLazyGetProjectOverviewQuery,
  useDownloadReportsMutation,
  useGetJobRunDetailsQuery,
  useLazyGetJobRunDetailsQuery,
  useLazyDownloadErrorLogsCSVQuery,
  useLazyGenerateErrorLogsQuery,
  useIsErrorLogsCsvReadyQuery,
  useStartConsolidatedDiscoveryReportMutation,
  useLazyGetConsolidatedReportStatusQuery,
  useLazyGetConsolidatedReportStatusByFileServerQuery,
  useLazyDownloadConsolidatedReportQuery,
} = reportApi;
