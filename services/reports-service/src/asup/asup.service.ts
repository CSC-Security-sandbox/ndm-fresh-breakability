import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from '../entities/project.entity';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobStatsSummaryMvEntity } from '../entities/job-stats-summary-mv.entity';
import { VolumeEntity } from '../entities/volume.entity';
import {
  MigrationAnalysisDto,
  ProjectMetricsDto,
  JobMetricsDto,
} from './dto/migration-analysis.dto';
import { JobType, JobRunStatus } from '../constants/enums';
import {
  LoggerService,
  LoggerFactory,
} from '@netapp-cloud-datamigrate/logger-lib';

// Mapping of internal server type values to friendly display names
const SERVER_TYPE_DISPLAY_NAMES: Record<string, string> = {
  'OtherNAS': 'OtherNAS',
  'other': 'OtherNAS',
  'dell': 'Dell Isilon',
  'emc': 'Dell EMC',
  'ANF': 'ANF',
  'anf': 'ANF',
  'Azure NetApp Files': 'ANF',
  'NetApp': 'NetApp',
  'netapp': 'NetApp',
  'ONTAP': 'NetApp ONTAP',
  'ontap': 'NetApp ONTAP',
  'FSx': 'Amazon FSx',
  'fsx': 'Amazon FSx',
  'GCP': 'Google Cloud',
  'gcp': 'Google Cloud',
};

@Injectable()
export class AsupService {
  private readonly logger: LoggerService;
  private readonly SCHEMA_VERSION = '1.3';

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(JobConfigEntity)
    private readonly jobConfigRepository: Repository<JobConfigEntity>,
    @InjectRepository(JobRunEntity)
    private readonly jobRunRepository: Repository<JobRunEntity>,
    @InjectRepository(JobStatsSummaryMvEntity)
    private readonly jobStatsSummaryMvRepository: Repository<JobStatsSummaryMvEntity>,
    @InjectRepository(VolumeEntity)
    private readonly volumeRepository: Repository<VolumeEntity>,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(AsupService.name);
    } else {
      this.logger = new Logger(AsupService.name) as any;
    }
  }

  /**
   * Generate migration analysis metrics for all projects
   * This data will be sent to ASUP on a weekly basis
   */
  async generateMigrationAnalysis(): Promise<MigrationAnalysisDto> {
    this.logger.log('Generating migration analysis for ASUP');

    const projects = await this.getAllProjectsWithJobConfigs();
    const projectMetrics: ProjectMetricsDto[] = [];

    for (const project of projects) {
      const metrics = await this.getProjectMetrics(project);
      if (metrics) {
        projectMetrics.push(metrics);
      }
    }

    const result: MigrationAnalysisDto = {
      generatedAt: this.formatDateWithTimezone(new Date()),
      schemaVersion: this.SCHEMA_VERSION,
      projects: projectMetrics,
    };

    this.logger.log(`Generated migration analysis with ${projectMetrics.length} projects`);
    return result;
  }

  /**
   * Generate migration analysis metrics for a specific project
   */
  async generateProjectMigrationAnalysis(projectId: string): Promise<ProjectMetricsDto | null> {
    this.logger.log(`Generating migration analysis for project: ${projectId}`);

    const project = await this.projectRepository.findOne({
      where: { id: projectId },
      relations: [
        'configs',
        'configs.fileServers',
        'configs.fileServers.volumes',
        'configs.fileServers.volumes.sourceConfig',
        'configs.fileServers.volumes.sourceConfig.jobRuns',
      ],
    });

    if (!project) {
      this.logger.warn(`Project not found: ${projectId}`);
      return null;
    }

    return this.getProjectMetrics(project);
  }

  /**
   * Get all projects with their job configurations
   */
  private async getAllProjectsWithJobConfigs(): Promise<ProjectEntity[]> {
    return this.projectRepository.find({
      relations: [
        'configs',
        'configs.fileServers',
        'configs.fileServers.volumes',
        'configs.fileServers.volumes.sourceConfig',
        'configs.fileServers.volumes.sourceConfig.jobRuns',
        'configs.fileServers.volumes.sourceConfig.sourcePath',
        'configs.fileServers.volumes.sourceConfig.destinationPath',
      ],
    });
  }

  /**
   * Calculate metrics for a single project
   * Groups jobs by (type, protocol, source, destination) configuration
   */
  private async getProjectMetrics(project: ProjectEntity): Promise<ProjectMetricsDto | null> {
    try {
      const allJobConfigs = this.extractJobConfigs(project);

      if (allJobConfigs.length === 0) {
        this.logger.debug(`No job configs found for project: ${project.id}`);
        return null;
      }

      // Group jobs by (type, protocol, source, destination)
      const jobGroups = new Map<string, {
        jobType: 'discovery' | 'migration' | 'cutover';
        protocol: string;
        source: string;
        destination: string;
        fileCount: number;
        totalSizeBytes: number;
        jobRunCount: number;
        jobConfigs: JobConfigEntity[];
      }>();

      for (const jobConfig of allJobConfigs) {
        const jobMetrics = await this.getJobMetricsRaw(jobConfig);
        
        // Create a unique key for this configuration
        const groupKey = `${jobMetrics.jobType}|${jobMetrics.protocol}|${jobMetrics.source}|${jobMetrics.destination}`;
        
        if (jobGroups.has(groupKey)) {
          // Add to existing group
          const group = jobGroups.get(groupKey)!;
          group.fileCount += jobMetrics.fileCount;
          group.totalSizeBytes += jobMetrics.totalSizeBytes;
          group.jobRunCount += jobMetrics.jobRunCount;
          group.jobConfigs.push(jobConfig);
        } else {
          // Create new group
          jobGroups.set(groupKey, {
            jobType: jobMetrics.jobType,
            protocol: jobMetrics.protocol,
            source: jobMetrics.source,
            destination: jobMetrics.destination,
            fileCount: jobMetrics.fileCount,
            totalSizeBytes: jobMetrics.totalSizeBytes,
            jobRunCount: jobMetrics.jobRunCount,
            jobConfigs: [jobConfig],
          });
        }
      }

      // Convert groups to JobMetricsDto array
      const jobs: JobMetricsDto[] = [];
      let jobIndex = 1;

      for (const [, group] of jobGroups) {
        // Generate a sequential job ID for the XML
        const jobId = `JOB-${String(jobIndex).padStart(3, '0')}`;
        
        jobs.push({
          jobId,
          jobType: group.jobType,
          protocol: group.protocol,
          source: group.source,
          destination: group.destination,
          fileCount: group.fileCount,
          totalSizeBytes: group.totalSizeBytes,
          jobRunCount: group.jobRunCount,
        });

        jobIndex++;
      }

      return {
        projectId: project.id,
        projectName: project.projectName || 'Unnamed Project',
        owner: null, // TODO: Get owner email from account/user info
        jobs,
      };
    } catch (error) {
      this.logger.error(`Error calculating metrics for project ${project.id}: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract all job configs from a project's nested structure
   */
  private extractJobConfigs(project: ProjectEntity): JobConfigEntity[] {
    const jobConfigs: JobConfigEntity[] = [];

    for (const config of project.configs || []) {
      for (const fileServer of config.fileServers || []) {
        for (const volume of fileServer.volumes || []) {
          if (volume.sourceConfig && Array.isArray(volume.sourceConfig)) {
            jobConfigs.push(...volume.sourceConfig);
          } else if (volume.sourceConfig) {
            jobConfigs.push(volume.sourceConfig as any);
          }
        }
      }
    }

    return jobConfigs;
  }

  /**
   * Get raw metrics for a job config (without generating job ID)
   */
  private async getJobMetricsRaw(jobConfig: JobConfigEntity): Promise<{
    jobType: 'discovery' | 'migration' | 'cutover';
    protocol: string;
    source: string;
    destination: string;
    fileCount: number;
    totalSizeBytes: number;
    jobRunCount: number;
  }> {
    const jobRuns = jobConfig.jobRuns || [];
    const jobRunCount = jobRuns.length;

    let totalFileCount = 0;
    let totalSizeBytes = 0;

    // Get the latest completed job run for discovery jobs
    // For migration/cutover, aggregate all completed runs
    const completedRuns = jobRuns.filter(run => run.status === JobRunStatus.Completed);

    if (jobConfig.jobType === JobType.Discover) {
      // For discovery, take the latest completed run
      const latestRun = completedRuns.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      if (latestRun) {
        const stats = await this.getJobRunStats(latestRun.id);
        totalFileCount = stats.fileCount;
        totalSizeBytes = stats.totalSize;
      }
    } else {
      // For migration/cutover, aggregate all completed runs
      for (const run of completedRuns) {
        const stats = await this.getJobRunStats(run.id);
        totalFileCount += stats.fileCount;
        totalSizeBytes += stats.totalSize;
      }
    }

    // Get source and destination info
    const sourceInfo = await this.getVolumeInfo(jobConfig.sourcePathId);
    const destInfo = jobConfig.destinationPathId 
      ? await this.getVolumeInfo(jobConfig.destinationPathId)
      : null;

    return {
      jobType: this.mapJobType(jobConfig.jobType),
      protocol: sourceInfo?.protocol || 'UNKNOWN',
      source: sourceInfo?.serverType || 'Unknown',
      destination: destInfo?.serverType || 'n/a',
      fileCount: totalFileCount,
      totalSizeBytes,
      jobRunCount,
    };
  }

  /**
   * Get stats from job_stats_summary_mv for a job run
   */
  private async getJobRunStats(jobRunId: string): Promise<{ fileCount: number; totalSize: number }> {
    try {
      const stats = await this.jobStatsSummaryMvRepository.findOne({
        where: { jobRunId },
      });

      if (stats) {
        return {
          fileCount: parseInt(stats.fileCount || '0', 10),
          totalSize: parseInt(stats.totalSize || '0', 10),
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to get stats for job run ${jobRunId}: ${error.message}`);
    }

    return { fileCount: 0, totalSize: 0 };
  }

  /**
   * Get volume and file server info
   * Returns the server_type (e.g., 'Dell Isilon', 'OtherNAS', 'ANF') not the config name
   */
  private async getVolumeInfo(volumeId: string): Promise<{ serverType: string; protocol: string } | null> {
    try {
      // Use query builder to explicitly select serverType which has select: false
      const volume = await this.volumeRepository
        .createQueryBuilder('volume')
        .leftJoinAndSelect('volume.fileServer', 'fileServer')
        .addSelect('fileServer.serverType')
        .where('volume.id = :volumeId', { volumeId })
        .getOne();

      if (volume?.fileServer) {
        // Get raw server type from file_server
        const rawServerType = volume.fileServer.serverType;
        
        // Map to friendly display name, fallback to raw value or host
        const displayName = this.mapServerTypeToDisplayName(
          rawServerType || volume.fileServer.host || 'Unknown'
        );
        
        return {
          serverType: displayName,
          protocol: volume.fileServer.protocol || 'UNKNOWN',
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to get volume info for ${volumeId}: ${error.message}`);
    }

    return null;
  }

  /**
   * Map internal server type value to friendly display name
   */
  private mapServerTypeToDisplayName(serverType: string): string {
    // Check if there's a mapping for this server type
    const displayName = SERVER_TYPE_DISPLAY_NAMES[serverType];
    if (displayName) {
      return displayName;
    }
    
    // If it looks like a hostname/IP, return a generic name
    if (serverType.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(serverType)) {
      return 'OtherNAS';
    }
    
    // Return as-is if no mapping found
    return serverType;
  }

  /**
   * Map internal job type to XML format
   */
  private mapJobType(jobType: JobType): 'discovery' | 'migration' | 'cutover' {
    switch (jobType) {
      case JobType.Discover:
        return 'discovery';
      case JobType.Migrate:
        return 'migration';
      case JobType.CutOver:
        return 'cutover';
      default:
        return 'discovery';
    }
  }

  /**
   * Convert migration analysis DTO to XML string
   */
  generateXml(analysis: MigrationAnalysisDto): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<MigrationAnalysis generatedAt="${analysis.generatedAt}" schemaVersion="${analysis.schemaVersion}">\n`;

    for (const project of analysis.projects) {
      xml += this.generateProjectXml(project);
    }

    xml += `</MigrationAnalysis>\n`;
    return xml;
  }

  private generateProjectXml(project: ProjectMetricsDto): string {
    let xml = `  <Project id="${project.projectId}" name="${this.escapeXml(project.projectName)}"`;
    if (project.owner) {
      xml += ` owner="${this.escapeXml(project.owner)}"`;
    }
    xml += `>\n`;

    xml += `    <Jobs>\n\n`;
    for (const job of project.jobs) {
      xml += this.generateJobXml(job);
    }
    xml += `    </Jobs>\n`;

    xml += `  </Project>\n`;
    return xml;
  }

  private generateJobXml(job: JobMetricsDto): string {
    let xml = `      <!-- ${job.jobType.toUpperCase()} JOB -->\n`;
    xml += `      <Job id="${job.jobId}" type="${job.jobType}" protocol="${job.protocol}">\n`;
    xml += `        <Source>${this.escapeXml(job.source)}</Source>\n`;
    xml += `        <Destination>${this.escapeXml(job.destination || 'n/a')}</Destination>\n`;

    if (job.jobType === 'discovery') {
      xml += `        <Discovered>\n`;
      xml += `          <FileCount>${job.fileCount}</FileCount>\n`;
      xml += `          <TotalSizeBytes>${job.totalSizeBytes}</TotalSizeBytes>\n`;
      xml += `        </Discovered>\n`;
    } else {
      xml += `        <Migrated>\n`;
      xml += `          <FileCount>${job.fileCount}</FileCount>\n`;
      xml += `          <TotalSizeBytes>${job.totalSizeBytes}</TotalSizeBytes>\n`;
      xml += `        </Migrated>\n`;
    }

    xml += `        <JobRunCount>${job.jobRunCount}</JobRunCount>\n`;
    xml += `      </Job>\n\n`;
    return xml;
  }

  private escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Format date with timezone offset (e.g., 2026-01-28T12:36:36+05:30)
   */
  private formatDateWithTimezone(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    
    // Get timezone offset in hours and minutes
    const tzOffset = -date.getTimezoneOffset();
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
    const tzMinutes = pad(Math.abs(tzOffset) % 60);
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMinutes}`;
  }
}
