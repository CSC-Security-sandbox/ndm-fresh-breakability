import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { prepareHeaders } from "@api/api.utils";

export interface AsupSettings {
  enabled: boolean;
  lastTransmission?: string;
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
    // Get ASUP settings (enabled/disabled status)
    getAsupSettings: builder.query<AsupSettings, void>({
      query: () => "asup/settings",
      providesTags: ["ASUP_SETTINGS"],
      transformResponse: (response: any) => {
        const settings = response?.data?.items || {};
        return {
          enabled: settings.enabled ?? false,
          lastTransmission: settings.lastTransmission,
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
        return response?.data?.items || {};
      },
    }),

  }),
});

export const {
  useGetAsupSettingsQuery,
  useLazyGetAsupSettingsQuery,
  useUpdateAsupSettingsMutation,
} = asupApi;
