/**
 * Test script for ASUP Migration Analysis metrics
 * 
 * Run this with: npx ts-node src/asup/asup.test-manual.ts
 * 
 * Make sure you have:
 * 1. Database connection configured
 * 2. Some test data in the database (projects, jobs, job runs)
 */

import { DataSource } from 'typeorm';

// Database configuration - update these values to match your environment
const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '8889'),
  username: process.env.DB_USER || 'dmadmin',
  password: process.env.DB_PASSWORD || 'dmadmin',
  database: process.env.DB_NAME || 'datamigrator',
  schema: process.env.DB_SCHEMA || 'datamigrator',
  logging: false,
});

async function testMetricsCollection() {
  console.log('🔍 Testing ASUP Migration Analysis Metrics Collection\n');
  console.log('='.repeat(60));

  try {
    // Connect to database
    console.log('\n📦 Connecting to database...');
    await dataSource.initialize();
    console.log('✅ Connected to database\n');

    // 1. Check Projects
    console.log('📊 Checking Projects...');
    const projects = await dataSource.query(`
      SELECT id, project_name, account_id, created_at 
      FROM datamigrator.project 
      LIMIT 10
    `);
    console.log(`   Found ${projects.length} project(s)`);
    projects.forEach((p: any) => {
      console.log(`   - ${p.project_name} (ID: ${p.id})`);
    });

    // 2. Check Job Configs
    console.log('\n📊 Checking Job Configs...');
    const jobConfigs = await dataSource.query(`
      SELECT jc.id, jc.job_type, jc.status, jc.source_path_id, jc.target_path_id,
             v.volume_path as source_path,
             fs.protocol,
             c.config_name as file_server_name
      FROM datamigrator.jobconfig jc
      LEFT JOIN datamigrator.volume v ON jc.source_path_id = v.id
      LEFT JOIN datamigrator.file_server fs ON v.file_server_id = fs.id
      LEFT JOIN datamigrator.config c ON fs.config_id = c.id
      LIMIT 20
    `);
    console.log(`   Found ${jobConfigs.length} job config(s)`);
    
    const byType: any = {};
    jobConfigs.forEach((j: any) => {
      byType[j.job_type] = (byType[j.job_type] || 0) + 1;
    });
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count} job(s)`);
    });

    // 3. Check Job Runs
    console.log('\n📊 Checking Job Runs...');
    const jobRuns = await dataSource.query(`
      SELECT jr.id, jr.status, jr.job_config_id, jr.start_time, jr.end_time,
             jc.job_type
      FROM datamigrator.jobrun jr
      LEFT JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id
      ORDER BY jr.created_at DESC
      LIMIT 20
    `);
    console.log(`   Found ${jobRuns.length} job run(s)`);
    
    const byStatus: any = {};
    jobRuns.forEach((r: any) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`   - ${status}: ${count} run(s)`);
    });

    // 4. Check Job Stats Summary (Materialized View)
    console.log('\n📊 Checking Job Stats Summary (MV)...');
    const jobStats = await dataSource.query(`
      SELECT job_run_id, file_count, directory_count, total_size, job_run_status
      FROM datamigrator.job_stats_summary_mv
      LIMIT 10
    `);
    console.log(`   Found ${jobStats.length} stats record(s)`);
    jobStats.forEach((s: any) => {
      console.log(`   - Run ${s.job_run_id.substring(0, 8)}...: ${s.file_count} files, ${formatBytes(parseInt(s.total_size || '0'))}`);
    });

    // 5. Check Storage Overview (Materialized View)
    console.log('\n📊 Checking Storage Overview (MV)...');
    const storageOverview = await dataSource.query(`
      SELECT project_id, config_id, 
             total_discovered_size, total_migrated_size, total_pending_size,
             debug_discovery_job_runs, debug_migration_job_runs
      FROM datamigrator.storage_jobs_overview_mv
      LIMIT 10
    `);
    console.log(`   Found ${storageOverview.length} storage overview record(s)`);
    storageOverview.forEach((s: any) => {
      console.log(`   - Project ${s.project_id?.substring(0, 8) || 'N/A'}...: Discovered=${formatBytes(parseInt(s.total_discovered_size || '0'))}, Migrated=${formatBytes(parseInt(s.total_migrated_size || '0'))}`);
    });

    // 6. Generate Sample XML
    console.log('\n📊 Generating Sample XML...');
    console.log('='.repeat(60));
    
    // Build the XML manually from the data we collected
    const xml = await generateSampleXml(dataSource);
    console.log(xml);
    
    console.log('='.repeat(60));
    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

async function generateSampleXml(ds: DataSource): Promise<string> {
  // Get projects with their metrics
  const projectsData = await ds.query(`
    SELECT 
      p.id as project_id,
      p.project_name,
      p.account_id
    FROM datamigrator.project p
    LIMIT 5
  `);

  if (projectsData.length === 0) {
    return '<!-- No projects found in database -->';
  }

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<MigrationAnalysis generatedAt="${formatDateWithTimezone(new Date())}" schemaVersion="1.3">\n`;

  for (const project of projectsData) {
    // Get jobs for this project
    const jobs = await ds.query(`
      SELECT 
        jc.id as job_id,
        jc.job_type,
        fs.protocol,
        c.config_name as source_name,
        c2.config_name as dest_name,
        COUNT(jr.id) as job_run_count
      FROM datamigrator.jobconfig jc
      LEFT JOIN datamigrator.volume v ON jc.source_path_id = v.id
      LEFT JOIN datamigrator.file_server fs ON v.file_server_id = fs.id
      LEFT JOIN datamigrator.config c ON fs.config_id = c.id
      LEFT JOIN datamigrator.volume v2 ON jc.target_path_id = v2.id
      LEFT JOIN datamigrator.file_server fs2 ON v2.file_server_id = fs2.id
      LEFT JOIN datamigrator.config c2 ON fs2.config_id = c2.id
      LEFT JOIN datamigrator.jobrun jr ON jc.id = jr.job_config_id
      WHERE c.project_id = $1
      GROUP BY jc.id, jc.job_type, fs.protocol, c.config_name, c2.config_name
    `, [project.project_id]);

    if (jobs.length === 0) continue;

    xml += `  <Project id="${project.project_id}" name="${escapeXml(project.project_name || 'Unnamed')}">\n`;
    xml += `    <Jobs>\n\n`;

    let totalDiscoveredFiles = 0;
    let totalDiscoveredSize = 0;
    let totalMigratedFiles = 0;
    let totalMigratedSize = 0;
    let totalJobRuns = 0;

    for (const job of jobs) {
      // Get stats for this job's runs
      const stats = await ds.query(`
        SELECT 
          COALESCE(SUM(CAST(jsm.file_count AS BIGINT)), 0) as file_count,
          COALESCE(SUM(CAST(jsm.total_size AS BIGINT)), 0) as total_size
        FROM datamigrator.jobrun jr
        LEFT JOIN datamigrator.job_stats_summary_mv jsm ON jr.id = jsm.job_run_id
        WHERE jr.job_config_id = $1 AND jr.status = 'COMPLETED'
      `, [job.job_id]);

      const fileCount = parseInt(stats[0]?.file_count || '0');
      const totalSize = parseInt(stats[0]?.total_size || '0');
      const runCount = parseInt(job.job_run_count || '0');
      totalJobRuns += runCount;

      const jobType = mapJobType(job.job_type);
      xml += `      <!-- ${jobType.toUpperCase()} JOB -->\n`;
      xml += `      <Job id="${job.job_id}" type="${jobType}" protocol="${job.protocol || 'UNKNOWN'}">\n`;
      xml += `        <Source>${escapeXml(job.source_name || 'Unknown')}</Source>\n`;
      xml += `        <Destination>${escapeXml(job.dest_name || 'n/a')}</Destination>\n`;

      if (jobType === 'discovery') {
        xml += `        <Discovered>\n`;
        xml += `          <FileCount>${fileCount}</FileCount>\n`;
        xml += `          <TotalSizeBytes>${totalSize}</TotalSizeBytes>\n`;
        xml += `        </Discovered>\n`;
        totalDiscoveredFiles += fileCount;
        totalDiscoveredSize += totalSize;
      } else {
        xml += `        <Migrated>\n`;
        xml += `          <FileCount>${fileCount}</FileCount>\n`;
        xml += `          <TotalSizeBytes>${totalSize}</TotalSizeBytes>\n`;
        xml += `        </Migrated>\n`;
        totalMigratedFiles += fileCount;
        totalMigratedSize += totalSize;
      }

      xml += `        <JobRunCount>${runCount}</JobRunCount>\n`;
      xml += `      </Job>\n\n`;
    }

    xml += `    </Jobs>\n\n`;
    xml += `    <ProjectTotals>\n`;
    xml += `      <Discovered>\n`;
    xml += `        <FileCount>${totalDiscoveredFiles || totalMigratedFiles}</FileCount>\n`;
    xml += `        <TotalSizeBytes>${totalDiscoveredSize || totalMigratedSize}</TotalSizeBytes>\n`;
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

function mapJobType(jobType: string): string {
  switch (jobType) {
    case 'DISCOVER': return 'discovery';
    case 'MIGRATE': return 'migration';
    case 'CUT_OVER': return 'cutover';
    default: return 'discovery';
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeXml(str: string): string {
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

// Run the test
testMetricsCollection();
