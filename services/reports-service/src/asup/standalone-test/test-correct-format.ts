import { Client } from 'pg';

// ============================================
// ASUP Test Script - Matches Required XML Format
// ============================================
// This script generates XML in the exact format required:
// - Groups jobs by (type, protocol, source_type, dest_type)
// - Uses server_type (e.g., 'Dell Isilon', 'OtherNAS', 'ANF')
// - Only outputs discovery, migration, cutover job types
// ============================================

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'datamigrator',
  user: process.env.DB_USER || 'dmadmin',
  password: process.env.DB_PASSWORD || 'dmadmin',
};

interface JobGroup {
  jobType: 'discovery' | 'migration' | 'cutover';
  protocol: string;
  sourceType: string;
  destinationType: string;
  fileCount: number;
  totalSizeBytes: number;
  jobRunCount: number;
}

interface ProjectData {
  projectId: string;
  projectName: string;
  owner: string | null;
  jobGroups: JobGroup[];
}

// Map job type from DB to XML format
function mapJobType(dbJobType: string): 'discovery' | 'migration' | 'cutover' | null {
  const typeMap: { [key: string]: 'discovery' | 'migration' | 'cutover' } = {
    'DISCOVER': 'discovery',
    'DISCOVERY': 'discovery',
    'MIGRATE': 'migration',
    'MIGRATION': 'migration',
    'CUTOVER': 'cutover',
    'CUT_OVER': 'cutover',
  };
  return typeMap[dbJobType?.toUpperCase()] || null;
}

function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateWithTimezone(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
  const tzMinutes = pad(Math.abs(tzOffset) % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMinutes}`;
}

async function getProjectsWithMetrics(client: Client): Promise<ProjectData[]> {
  const projects: ProjectData[] = [];

  // Get all projects
  const projectsQuery = `
    SELECT id, project_name 
    FROM datamigrator.project 
    ORDER BY created_at DESC
  `;
  const projectsResult = await client.query(projectsQuery);

  for (const projectRow of projectsResult.rows) {
    const projectId = projectRow.id;
    const projectName = projectRow.project_name;

    // Get all job configs with their source and destination server types
    // This query joins through the volume -> file_server -> config chain
    const jobConfigsQuery = `
      SELECT 
        jc.id as job_config_id,
        jc.job_type,
        src_fs.protocol as protocol,
        src_config.server_type as source_type,
        dest_config.server_type as dest_type,
        COUNT(DISTINCT jr.id) as job_run_count,
        COALESCE(SUM(
          CASE WHEN jr.status = 'COMPLETED' THEN 
            COALESCE((SELECT file_count FROM datamigrator.job_stats_summary_mv WHERE job_run_id = jr.id), 0)
          ELSE 0 END
        ), 0) as file_count,
        COALESCE(SUM(
          CASE WHEN jr.status = 'COMPLETED' THEN 
            COALESCE((SELECT total_size FROM datamigrator.job_stats_summary_mv WHERE job_run_id = jr.id), 0)
          ELSE 0 END
        ), 0) as total_size
      FROM datamigrator.jobconfig jc
      -- Join to source volume -> file_server -> config
      JOIN datamigrator.volume src_vol ON src_vol.id = jc.source_path_id
      JOIN datamigrator.file_server src_fs ON src_fs.id = src_vol.file_server_id
      JOIN datamigrator.config src_config ON src_config.id = src_fs.config_id
      -- Left join to destination (may be null for discovery jobs)
      LEFT JOIN datamigrator.volume dest_vol ON dest_vol.id = jc.target_path_id
      LEFT JOIN datamigrator.file_server dest_fs ON dest_fs.id = dest_vol.file_server_id
      LEFT JOIN datamigrator.config dest_config ON dest_config.id = dest_fs.config_id
      -- Join to job runs
      LEFT JOIN datamigrator.jobrun jr ON jr.job_config_id = jc.id
      WHERE src_config.project_id = $1
      GROUP BY jc.id, jc.job_type, src_fs.protocol, src_config.server_type, dest_config.server_type
    `;

    const jobConfigsResult = await client.query(jobConfigsQuery, [projectId]);

    // Group jobs by (type, protocol, source_type, dest_type)
    const groupMap = new Map<string, JobGroup>();

    for (const row of jobConfigsResult.rows) {
      const jobType = mapJobType(row.job_type);
      if (!jobType) continue; // Skip invalid job types

      const protocol = row.protocol || 'UNKNOWN';
      const sourceType = row.source_type || 'Unknown';
      const destType = jobType === 'discovery' ? 'n/a' : (row.dest_type || 'Unknown');

      const groupKey = `${jobType}|${protocol}|${sourceType}|${destType}`;

      if (groupMap.has(groupKey)) {
        const group = groupMap.get(groupKey)!;
        group.fileCount += parseInt(row.file_count) || 0;
        group.totalSizeBytes += parseInt(row.total_size) || 0;
        group.jobRunCount += parseInt(row.job_run_count) || 0;
      } else {
        groupMap.set(groupKey, {
          jobType,
          protocol,
          sourceType,
          destinationType: destType,
          fileCount: parseInt(row.file_count) || 0,
          totalSizeBytes: parseInt(row.total_size) || 0,
          jobRunCount: parseInt(row.job_run_count) || 0,
        });
      }
    }

    projects.push({
      projectId,
      projectName,
      owner: null, // Would need to join with user table
      jobGroups: Array.from(groupMap.values()),
    });
  }

  return projects;
}

function generateXml(projects: ProjectData[]): string {
  const generatedAt = formatDateWithTimezone(new Date());
  
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<MigrationAnalysis generatedAt="${generatedAt}" schemaVersion="1.3">\n`;

  for (const project of projects) {
    xml += `  <Project id="${escapeXml(project.projectId)}" name="${escapeXml(project.projectName)}"`;
    if (project.owner) {
      xml += ` owner="${escapeXml(project.owner)}"`;
    }
    xml += `>\n`;
    xml += `    <Jobs>\n\n`;

    let jobIndex = 1;
    let totalDiscoveredFiles = 0;
    let totalDiscoveredSize = 0;
    let totalMigratedFiles = 0;
    let totalMigratedSize = 0;
    let totalJobRuns = 0;

    for (const group of project.jobGroups) {
      const jobId = `JOB-${String(jobIndex).padStart(3, '0')}`;
      
      xml += `      <!-- ${group.jobType.toUpperCase()} JOB -->\n`;
      xml += `      <Job id="${jobId}" type="${group.jobType}" protocol="${group.protocol}">\n`;
      xml += `        <Source>${escapeXml(group.sourceType)}</Source>\n`;
      xml += `        <Destination>${escapeXml(group.destinationType)}</Destination>\n`;

      if (group.jobType === 'discovery') {
        xml += `        <Discovered>\n`;
        xml += `          <FileCount>${group.fileCount}</FileCount>\n`;
        xml += `          <TotalSizeBytes>${group.totalSizeBytes}</TotalSizeBytes>\n`;
        xml += `        </Discovered>\n`;
        totalDiscoveredFiles += group.fileCount;
        totalDiscoveredSize += group.totalSizeBytes;
      } else {
        xml += `        <Migrated>\n`;
        xml += `          <FileCount>${group.fileCount}</FileCount>\n`;
        xml += `          <TotalSizeBytes>${group.totalSizeBytes}</TotalSizeBytes>\n`;
        xml += `        </Migrated>\n`;
        totalMigratedFiles += group.fileCount;
        totalMigratedSize += group.totalSizeBytes;
      }

      xml += `        <JobRunCount>${group.jobRunCount}</JobRunCount>\n`;
      xml += `      </Job>\n\n`;

      totalJobRuns += group.jobRunCount;
      jobIndex++;
    }

    xml += `    </Jobs>\n\n`;

    // Project totals
    xml += `    <ProjectTotals>\n`;
    xml += `      <Discovered>\n`;
    xml += `        <FileCount>${totalDiscoveredFiles > 0 ? totalDiscoveredFiles : totalMigratedFiles}</FileCount>\n`;
    xml += `        <TotalSizeBytes>${totalDiscoveredSize > 0 ? totalDiscoveredSize : totalMigratedSize}</TotalSizeBytes>\n`;
    xml += `      </Discovered>\n`;
    xml += `      <Migrated>\n`;
    xml += `        <FileCount>${totalMigratedFiles}</FileCount>\n`;
    xml += `        <TotalSizeBytes>${totalMigratedSize}</TotalSizeBytes>\n`;
    xml += `      </Migrated>\n`;
    xml += `      <TotalJobRuns>${totalJobRuns}</TotalJobRuns>\n`;
    xml += `    </ProjectTotals>\n`;
    xml += `  </Project>\n`;
  }

  xml += `</MigrationAnalysis>\n`;
  return xml;
}

async function main() {
  console.log('==========================================');
  console.log('ASUP XML Test - Correct Format');
  console.log('==========================================\n');
  console.log('Database Config:', DB_CONFIG.host, DB_CONFIG.database);
  console.log('');

  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('Connected to database\n');

    // First, let's verify the data
    console.log('Verifying database data...\n');

    // Check projects
    const projectsCheck = await client.query('SELECT id, project_name FROM datamigrator.project');
    console.log(`Projects: ${projectsCheck.rowCount}`);
    for (const p of projectsCheck.rows) {
      console.log(`  - ${p.project_name} (${p.id})`);
    }

    // Check job configs with server types
    const jobConfigsCheck = await client.query(`
      SELECT 
        jc.job_type,
        src_fs.protocol,
        src_config.server_type as source_type,
        dest_config.server_type as dest_type,
        COUNT(jr.id) as run_count
      FROM datamigrator.jobconfig jc
      JOIN datamigrator.volume src_vol ON src_vol.id = jc.source_path_id
      JOIN datamigrator.file_server src_fs ON src_fs.id = src_vol.file_server_id
      JOIN datamigrator.config src_config ON src_config.id = src_fs.config_id
      LEFT JOIN datamigrator.volume dest_vol ON dest_vol.id = jc.target_path_id
      LEFT JOIN datamigrator.file_server dest_fs ON dest_fs.id = dest_vol.file_server_id
      LEFT JOIN datamigrator.config dest_config ON dest_config.id = dest_fs.config_id
      LEFT JOIN datamigrator.jobrun jr ON jr.job_config_id = jc.id
      GROUP BY jc.job_type, src_fs.protocol, src_config.server_type, dest_config.server_type
    `);
    console.log(`\nJob Configs (grouped by type/protocol/source/dest):`);
    for (const jc of jobConfigsCheck.rows) {
      console.log(`  - Type: ${jc.job_type}, Protocol: ${jc.protocol}, Source: ${jc.source_type}, Dest: ${jc.dest_type}, Runs: ${jc.run_count}`);
    }

    // Check job stats
    const statsCheck = await client.query('SELECT job_run_id, file_count, total_size FROM datamigrator.job_stats_summary_mv');
    console.log(`\nJob Stats Summary MV: ${statsCheck.rowCount} rows`);
    for (const s of statsCheck.rows) {
      console.log(`  - RunID: ${s.job_run_id.substring(0, 8)}..., Files: ${s.file_count}, Size: ${s.total_size}`);
    }

    console.log('\n');

    // Generate metrics
    const projects = await getProjectsWithMetrics(client);
    const xml = generateXml(projects);

    console.log('==========================================');
    console.log('Generated ASUP XML:');
    console.log('==========================================\n');
    console.log(xml);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

main().catch(console.error);
