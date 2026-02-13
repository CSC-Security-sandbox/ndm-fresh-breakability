import { Client } from 'pg';

// ============================================
// ASUP Standalone Test Script
// ============================================
// This script connects directly to the database,
// queries all project/job metrics, and generates
// the ASUP XML for NetApp telemetry.
//
// Usage:
//   cd standalone-test
//   npm install
//   npx ts-node test.ts
// ============================================

// Database connection configuration
// Update these values to match your environment
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'datamigrator',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

interface ProjectMetrics {
  projectId: string;
  projectName: string;
  projectType: string;
  projectOwnerEmail: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  totalJobs: number;
  totalJobRuns: number;
  successfulJobRuns: number;
  failedJobRuns: number;
  totalFilesDiscovered: number;
  totalFilesDiscoveredSize: number;
  totalFilesMigrated: number;
  totalFilesMigratedSize: number;
  totalFoldersDiscovered: number;
  totalFoldersMigrated: number;
  averageMigrationDurationMs: number;
  lastMigrationDate: string | null;
  jobs: JobMetrics[];
}

interface JobMetrics {
  jobId: string;
  jobName: string;
  jobType: string;
  sourceType: string;
  targetType: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  filesDiscovered: number;
  filesDiscoveredSize: number;
  filesMigrated: number;
  filesMigratedSize: number;
  foldersDiscovered: number;
  foldersMigrated: number;
  averageDurationMs: number;
  lastRunDate: string | null;
}

interface MigrationAnalysisMetrics {
  generatedAt: string;
  systemVersion: string;
  totalProjects: number;
  totalJobs: number;
  totalJobRuns: number;
  totalFilesDiscovered: number;
  totalFilesDiscoveredSize: number;
  totalFilesMigrated: number;
  totalFilesMigratedSize: number;
  totalFoldersDiscovered: number;
  totalFoldersMigrated: number;
  projects: ProjectMetrics[];
}

async function getProjectMetrics(client: Client): Promise<ProjectMetrics[]> {
  // Get all projects with their metrics
  // Using datamigrator schema which is the actual schema in this database
  const projectsQuery = `
    SELECT 
      p.id as project_id,
      p.project_name,
      p.project_description,
      p.created_at,
      p.updated_at,
      p.start_date
    FROM datamigrator.project p
    ORDER BY p.created_at DESC
  `;

  const projectsResult = await client.query(projectsQuery);
  const projects: ProjectMetrics[] = [];

  for (const row of projectsResult.rows) {
    const projectId = row.project_id;

    // Get job configs associated with this project through config table
    // config.project_id links to project, and jobconfig links to config via paths
    const jobsQuery = `
      SELECT DISTINCT
        jc.id as job_id,
        jc.job_type,
        jc.status,
        jc.created_at,
        jc.updated_at,
        c.config_name,
        c.server_type as source_type
      FROM datamigrator.jobconfig jc
      JOIN datamigrator.volume v ON v.id = jc.source_path_id
      JOIN datamigrator.file_server fs ON fs.id = v.file_server_id
      JOIN datamigrator.config c ON c.id = fs.config_id
      WHERE c.project_id = $1
      ORDER BY jc.created_at DESC
    `;

    let jobsResult;
    try {
      jobsResult = await client.query(jobsQuery, [projectId]);
    } catch (err) {
      // If the complex join fails, try a simpler approach
      console.log(`  Warning: Complex job query failed for project ${projectId}, trying simpler query...`);
      jobsResult = { rows: [] };
    }

    const jobs: JobMetrics[] = [];

    let projectTotalRuns = 0;
    let projectSuccessfulRuns = 0;
    let projectFailedRuns = 0;
    let projectFilesDiscovered = 0;
    let projectFilesDiscoveredSize = 0;
    let projectFilesMigrated = 0;
    let projectFilesMigratedSize = 0;
    let projectFoldersDiscovered = 0;
    let projectFoldersMigrated = 0;
    let projectTotalDuration = 0;
    let projectDurationCount = 0;
    let projectLastMigrationDate: string | null = null;

    for (const jobRow of jobsResult.rows) {
      const jobId = jobRow.job_id;

      // Get job run statistics from datamigrator.jobrun
      const runsQuery = `
        SELECT 
          COUNT(*) as total_runs,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') as successful_runs,
          COUNT(*) FILTER (WHERE status = 'FAILED') as failed_runs,
          AVG(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000) FILTER (WHERE end_time IS NOT NULL AND start_time IS NOT NULL) as avg_duration_ms,
          MAX(end_time) as last_run_date
        FROM datamigrator.jobrun
        WHERE job_config_id = $1
      `;

      const runsResult = await client.query(runsQuery, [jobId]);
      const runStats = runsResult.rows[0] || {};

      // Get discovery metrics from job_config_inventory_stats
      const discoveryQuery = `
        SELECT 
          COALESCE(file_count, 0) as files_discovered,
          COALESCE(total_size, 0) as files_discovered_size,
          COALESCE(dir_count, 0) as folders_discovered
        FROM datamigrator.job_config_inventory_stats
        WHERE job_config_id = $1
      `;

      let discoveryStats = { 
        files_discovered: 0, 
        files_discovered_size: 0, 
        folders_discovered: 0
      };

      try {
        const discoveryResult = await client.query(discoveryQuery, [jobId]);
        if (discoveryResult.rows.length > 0) {
          discoveryStats = discoveryResult.rows[0];
        }
      } catch (err) {
        // Ignore errors
      }

      // Get migrated stats from job_stats JSON in jobrun
      let migratedStats = {
        files_migrated: 0,
        files_migrated_size: 0,
        folders_migrated: 0
      };

      try {
        const migratedQuery = `
          SELECT 
            COALESCE(SUM((job_stats->>'filesCopied')::bigint), 0) as files_migrated,
            COALESCE(SUM((job_stats->>'bytesCopied')::bigint), 0) as files_migrated_size,
            COALESCE(SUM((job_stats->>'dirsCopied')::bigint), 0) as folders_migrated
          FROM datamigrator.jobrun
          WHERE job_config_id = $1 AND job_stats IS NOT NULL
        `;
        const migratedResult = await client.query(migratedQuery, [jobId]);
        if (migratedResult.rows.length > 0) {
          migratedStats = migratedResult.rows[0];
        }
      } catch (err) {
        // Ignore errors
      }

      const jobMetrics: JobMetrics = {
        jobId: jobRow.job_id,
        jobName: jobRow.config_name || `Job ${jobRow.job_id.substring(0, 8)}`,
        jobType: jobRow.job_type || '',
        sourceType: jobRow.source_type || '',
        targetType: '', // Would need to join target volume info
        createdAt: jobRow.created_at?.toISOString() || '',
        updatedAt: jobRow.updated_at?.toISOString() || '',
        status: jobRow.status || 'UNKNOWN',
        totalRuns: parseInt(runStats.total_runs) || 0,
        successfulRuns: parseInt(runStats.successful_runs) || 0,
        failedRuns: parseInt(runStats.failed_runs) || 0,
        filesDiscovered: Number(discoveryStats.files_discovered) || 0,
        filesDiscoveredSize: Number(discoveryStats.files_discovered_size) || 0,
        filesMigrated: Number(migratedStats.files_migrated) || 0,
        filesMigratedSize: Number(migratedStats.files_migrated_size) || 0,
        foldersDiscovered: Number(discoveryStats.folders_discovered) || 0,
        foldersMigrated: Number(migratedStats.folders_migrated) || 0,
        averageDurationMs: parseFloat(runStats.avg_duration_ms) || 0,
        lastRunDate: runStats.last_run_date?.toISOString() || null,
      };

      jobs.push(jobMetrics);

      // Aggregate for project totals
      projectTotalRuns += jobMetrics.totalRuns;
      projectSuccessfulRuns += jobMetrics.successfulRuns;
      projectFailedRuns += jobMetrics.failedRuns;
      projectFilesDiscovered += jobMetrics.filesDiscovered;
      projectFilesDiscoveredSize += jobMetrics.filesDiscoveredSize;
      projectFilesMigrated += jobMetrics.filesMigrated;
      projectFilesMigratedSize += jobMetrics.filesMigratedSize;
      projectFoldersDiscovered += jobMetrics.foldersDiscovered;
      projectFoldersMigrated += jobMetrics.foldersMigrated;
      
      if (jobMetrics.averageDurationMs > 0) {
        projectTotalDuration += jobMetrics.averageDurationMs;
        projectDurationCount++;
      }

      if (jobMetrics.lastRunDate) {
        if (!projectLastMigrationDate || jobMetrics.lastRunDate > projectLastMigrationDate) {
          projectLastMigrationDate = jobMetrics.lastRunDate;
        }
      }
    }

    const projectMetrics: ProjectMetrics = {
      projectId: row.project_id,
      projectName: row.project_name || '',
      projectType: '', // Not available in this schema
      projectOwnerEmail: '', // Would need to join with user table
      createdAt: row.created_at?.toISOString() || '',
      updatedAt: row.updated_at?.toISOString() || '',
      status: 'ACTIVE', // No status field in project table
      totalJobs: jobs.length,
      totalJobRuns: projectTotalRuns,
      successfulJobRuns: projectSuccessfulRuns,
      failedJobRuns: projectFailedRuns,
      totalFilesDiscovered: projectFilesDiscovered,
      totalFilesDiscoveredSize: projectFilesDiscoveredSize,
      totalFilesMigrated: projectFilesMigrated,
      totalFilesMigratedSize: projectFilesMigratedSize,
      totalFoldersDiscovered: projectFoldersDiscovered,
      totalFoldersMigrated: projectFoldersMigrated,
      averageMigrationDurationMs: projectDurationCount > 0 ? projectTotalDuration / projectDurationCount : 0,
      lastMigrationDate: projectLastMigrationDate,
      jobs: jobs,
    };

    projects.push(projectMetrics);
  }

  return projects;
}

function generateXml(metrics: MigrationAnalysisMetrics): string {
  const escapeXml = (str: string): string => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<MigrationAnalysis xmlns="http://www.netapp.com/asup/migration-analysis" version="1.0">
  <GeneratedAt>${escapeXml(metrics.generatedAt)}</GeneratedAt>
  <SystemVersion>${escapeXml(metrics.systemVersion)}</SystemVersion>
  
  <Summary>
    <TotalProjects>${metrics.totalProjects}</TotalProjects>
    <TotalJobs>${metrics.totalJobs}</TotalJobs>
    <TotalJobRuns>${metrics.totalJobRuns}</TotalJobRuns>
    <TotalFilesDiscovered>${metrics.totalFilesDiscovered}</TotalFilesDiscovered>
    <TotalFilesDiscoveredSize unit="bytes">${metrics.totalFilesDiscoveredSize}</TotalFilesDiscoveredSize>
    <TotalFilesDiscoveredSizeFormatted>${formatBytes(metrics.totalFilesDiscoveredSize)}</TotalFilesDiscoveredSizeFormatted>
    <TotalFilesMigrated>${metrics.totalFilesMigrated}</TotalFilesMigrated>
    <TotalFilesMigratedSize unit="bytes">${metrics.totalFilesMigratedSize}</TotalFilesMigratedSize>
    <TotalFilesMigratedSizeFormatted>${formatBytes(metrics.totalFilesMigratedSize)}</TotalFilesMigratedSizeFormatted>
    <TotalFoldersDiscovered>${metrics.totalFoldersDiscovered}</TotalFoldersDiscovered>
    <TotalFoldersMigrated>${metrics.totalFoldersMigrated}</TotalFoldersMigrated>
  </Summary>

  <Projects>`;

  for (const project of metrics.projects) {
    xml += `
    <Project id="${escapeXml(project.projectId)}">
      <Name>${escapeXml(project.projectName)}</Name>
      <Type>${escapeXml(project.projectType)}</Type>
      <OwnerEmail>${escapeXml(project.projectOwnerEmail)}</OwnerEmail>
      <CreatedAt>${escapeXml(project.createdAt)}</CreatedAt>
      <UpdatedAt>${escapeXml(project.updatedAt)}</UpdatedAt>
      <Status>${escapeXml(project.status)}</Status>
      
      <Metrics>
        <TotalJobs>${project.totalJobs}</TotalJobs>
        <TotalJobRuns>${project.totalJobRuns}</TotalJobRuns>
        <SuccessfulJobRuns>${project.successfulJobRuns}</SuccessfulJobRuns>
        <FailedJobRuns>${project.failedJobRuns}</FailedJobRuns>
        <FilesDiscovered>${project.totalFilesDiscovered}</FilesDiscovered>
        <FilesDiscoveredSize unit="bytes">${project.totalFilesDiscoveredSize}</FilesDiscoveredSize>
        <FilesDiscoveredSizeFormatted>${formatBytes(project.totalFilesDiscoveredSize)}</FilesDiscoveredSizeFormatted>
        <FilesMigrated>${project.totalFilesMigrated}</FilesMigrated>
        <FilesMigratedSize unit="bytes">${project.totalFilesMigratedSize}</FilesMigratedSize>
        <FilesMigratedSizeFormatted>${formatBytes(project.totalFilesMigratedSize)}</FilesMigratedSizeFormatted>
        <FoldersDiscovered>${project.totalFoldersDiscovered}</FoldersDiscovered>
        <FoldersMigrated>${project.totalFoldersMigrated}</FoldersMigrated>
        <AverageMigrationDuration unit="ms">${Math.round(project.averageMigrationDurationMs)}</AverageMigrationDuration>
        <LastMigrationDate>${project.lastMigrationDate ? escapeXml(project.lastMigrationDate) : ''}</LastMigrationDate>
      </Metrics>

      <Jobs>`;

    for (const job of project.jobs) {
      xml += `
        <Job id="${escapeXml(job.jobId)}">
          <Name>${escapeXml(job.jobName)}</Name>
          <Type>${escapeXml(job.jobType)}</Type>
          <SourceType>${escapeXml(job.sourceType)}</SourceType>
          <TargetType>${escapeXml(job.targetType)}</TargetType>
          <CreatedAt>${escapeXml(job.createdAt)}</CreatedAt>
          <UpdatedAt>${escapeXml(job.updatedAt)}</UpdatedAt>
          <Status>${escapeXml(job.status)}</Status>
          
          <Metrics>
            <TotalRuns>${job.totalRuns}</TotalRuns>
            <SuccessfulRuns>${job.successfulRuns}</SuccessfulRuns>
            <FailedRuns>${job.failedRuns}</FailedRuns>
            <FilesDiscovered>${job.filesDiscovered}</FilesDiscovered>
            <FilesDiscoveredSize unit="bytes">${job.filesDiscoveredSize}</FilesDiscoveredSize>
            <FilesDiscoveredSizeFormatted>${formatBytes(job.filesDiscoveredSize)}</FilesDiscoveredSizeFormatted>
            <FilesMigrated>${job.filesMigrated}</FilesMigrated>
            <FilesMigratedSize unit="bytes">${job.filesMigratedSize}</FilesMigratedSize>
            <FilesMigratedSizeFormatted>${formatBytes(job.filesMigratedSize)}</FilesMigratedSizeFormatted>
            <FoldersDiscovered>${job.foldersDiscovered}</FoldersDiscovered>
            <FoldersMigrated>${job.foldersMigrated}</FoldersMigrated>
            <AverageDuration unit="ms">${Math.round(job.averageDurationMs)}</AverageDuration>
            <LastRunDate>${job.lastRunDate ? escapeXml(job.lastRunDate) : ''}</LastRunDate>
          </Metrics>
        </Job>`;
    }

    xml += `
      </Jobs>
    </Project>`;
  }

  xml += `
  </Projects>
</MigrationAnalysis>`;

  return xml;
}

async function main() {
  console.log('======================================');
  console.log('ASUP Migration Analysis XML Generator');
  console.log('======================================\n');
  console.log('Database Configuration:');
  console.log(`  Host: ${DB_CONFIG.host}`);
  console.log(`  Port: ${DB_CONFIG.port}`);
  console.log(`  Database: ${DB_CONFIG.database}`);
  console.log(`  User: ${DB_CONFIG.user}`);
  console.log('');

  const client = new Client(DB_CONFIG);

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!\n');

    // Check what tables exist
    console.log('Checking available tables...');
    const tablesQuery = `
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema IN ('config', 'jobs', 'admin')
      ORDER BY table_schema, table_name
    `;
    const tablesResult = await client.query(tablesQuery);
    console.log('Available tables:');
    for (const row of tablesResult.rows) {
      console.log(`  ${row.table_schema}.${row.table_name}`);
    }
    console.log('');

    // Get project metrics
    console.log('Collecting project metrics...');
    const projects = await getProjectMetrics(client);
    console.log(`Found ${projects.length} projects\n`);

    // Aggregate totals
    const metrics: MigrationAnalysisMetrics = {
      generatedAt: new Date().toISOString(),
      systemVersion: '1.0.0',
      totalProjects: projects.length,
      totalJobs: projects.reduce((sum, p) => sum + p.totalJobs, 0),
      totalJobRuns: projects.reduce((sum, p) => sum + p.totalJobRuns, 0),
      totalFilesDiscovered: projects.reduce((sum, p) => sum + p.totalFilesDiscovered, 0),
      totalFilesDiscoveredSize: projects.reduce((sum, p) => sum + p.totalFilesDiscoveredSize, 0),
      totalFilesMigrated: projects.reduce((sum, p) => sum + p.totalFilesMigrated, 0),
      totalFilesMigratedSize: projects.reduce((sum, p) => sum + p.totalFilesMigratedSize, 0),
      totalFoldersDiscovered: projects.reduce((sum, p) => sum + p.totalFoldersDiscovered, 0),
      totalFoldersMigrated: projects.reduce((sum, p) => sum + p.totalFoldersMigrated, 0),
      projects: projects,
    };

    // Generate XML
    console.log('Generating XML...');
    const xml = generateXml(metrics);

    console.log('\n======================================');
    console.log('GENERATED XML OUTPUT:');
    console.log('======================================\n');
    console.log(xml);
    console.log('\n======================================');
    console.log('END OF XML OUTPUT');
    console.log('======================================\n');

    // Summary
    console.log('Summary:');
    console.log(`  Total Projects: ${metrics.totalProjects}`);
    console.log(`  Total Jobs: ${metrics.totalJobs}`);
    console.log(`  Total Job Runs: ${metrics.totalJobRuns}`);
    console.log(`  Total Files Discovered: ${metrics.totalFilesDiscovered}`);
    console.log(`  Total Files Migrated: ${metrics.totalFilesMigrated}`);
    console.log(`  Total Size Migrated: ${formatBytes(metrics.totalFilesMigratedSize)}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

main().catch(console.error);
