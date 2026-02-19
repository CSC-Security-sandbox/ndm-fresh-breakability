import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export interface AsupSettings {
  enabled: boolean;
  consentGiven: boolean;
  lastUpdated?: string;
  lastTransmission?: string;
  xmlPreview?: string;  // XML preview returned when consent is given
}

export interface MigrationAnalysis {
  generatedAt: string;
  schemaVersion: string;
  projects: ProjectMetrics[];
}

export interface ProjectMetrics {
  projectId: string;
  projectName: string;
  owner: string | null;
  jobs: JobMetrics[];
  projectTotals: {
    discovered: { fileCount: number; totalSizeBytes: number };
    migrated: { fileCount: number; totalSizeBytes: number };
    totalJobRuns: number;
  };
}

export interface JobMetrics {
  jobId: string;
  jobType: "discovery" | "migration" | "cutover";
  protocol: string;
  source: string;
  destination: string;
  fileCount: number;
  totalSizeBytes: number;
  jobRunCount: number;
}

export const asupApi = createApi({
  reducerPath: "asupApi",
  tagTypes: ["ASUP_SETTINGS", "ASUP_METRICS"],
  baseQuery: fetchBaseQuery({
    baseUrl:
      window?.env?.VITE_REPORTS_SERVICE_URL ||
      import.meta.env.VITE_REPORTS_SERVICE_URL,
    prepareHeaders,
  }),
  endpoints: (builder) => ({
    // Get ASUP settings (enabled/disabled, consent status)
    getAsupSettings: builder.query<AsupSettings, void>({
      query: () => "asup/settings",
      providesTags: ["ASUP_SETTINGS"],
      transformResponse: (response: any) => {
        // API response format: { data: { items: { enabled, consentGiven, ... } } }
        const settings = response?.data?.items || response?.data || response || {};
        return {
          enabled: settings.enabled ?? false,
          consentGiven: settings.consentGiven ?? false,
          lastUpdated: settings.lastUpdated || null,
          lastTransmission: settings.lastTransmission || null,
        };
      },
    }),

    // Update ASUP settings (enable/disable)
    updateAsupSettings: builder.mutation<AsupSettings, Partial<AsupSettings>>({
      query: (settings) => ({
        url: "asup/settings",
        method: "PUT",
        body: settings,
      }),
      invalidatesTags: ["ASUP_SETTINGS"],
      transformResponse: (response: any) => {
        // Extract from wrapped response: { data: { items: { ... } } }
        return response?.data?.items || response?.data || response || {};
      },
    }),

    // Get migration analysis metrics (JSON)
    getMigrationAnalysis: builder.query<MigrationAnalysis, void>({
      query: () => "asup/migration-analysis",
      providesTags: ["ASUP_METRICS"],
      transformResponse: (response: any) => {
        return response?.data || response || {};
      },
    }),

    // Preview migration analysis XML
    previewMigrationAnalysisXml: builder.query<string, void>({
      query: () => ({
        url: "asup/migration-analysis/xml/preview",
        responseHandler: (response) => response.text(),
      }),
    }),

    // Download migration analysis XML
    downloadMigrationAnalysisXml: builder.mutation<Blob, void>({
      query: () => ({
        url: "asup/migration-analysis/xml",
        method: "GET",
        responseHandler: (response) => response.blob(),
      }),
    }),

    // Manually trigger ASUP transmission (for testing/admin)
    triggerAsupTransmission: builder.mutation<{ success: boolean; message: string }, void>({
      query: () => ({
        url: "asup/transmit",
        method: "POST",
      }),
    }),
  }),
});

export const {
  useGetAsupSettingsQuery,
  useLazyGetAsupSettingsQuery,
  useUpdateAsupSettingsMutation,
  useGetMigrationAnalysisQuery,
  useLazyPreviewMigrationAnalysisXmlQuery,
  useDownloadMigrationAnalysisXmlMutation,
  useTriggerAsupTransmissionMutation,
} = asupApi;
