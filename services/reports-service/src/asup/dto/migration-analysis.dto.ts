/**
 * DTOs for ASUP Migration Analysis XML generation
 */

export interface JobMetricsDto {
  jobId: string;
  jobType: 'discovery' | 'migration' | 'cutover';
  protocol: string;
  source: string;
  destination: string | null;
  fileCount: number;
  totalSizeBytes: number;
  jobRunCount: number;
}

export interface ProjectMetricsDto {
  projectId: string;
  projectName: string;
  owner: string | null;
  jobs: JobMetricsDto[];
}

export interface MigrationAnalysisDto {
  generatedAt: string;
  schemaVersion: string;
  projects: ProjectMetricsDto[];
}
