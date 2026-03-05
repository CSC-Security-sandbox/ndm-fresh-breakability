import { Injectable, Inject } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AsupStatsService, ProjectStats } from './asup-stats.service';

/**
 * AsupXmlGeneratorService
 * 
 * Generates the ASUP XML report from aggregated job stats.
 * The XML format matches the required schema for ASUP transmission.
 */
@Injectable()
export class AsupXmlGeneratorService {
  private readonly logger: LoggerService;
  private readonly templatesDir = path.join(__dirname, 'templates');
  /** Parsed migration body: prefix (DOCTYPE + root + table info), row template, suffix (closing tags). */
  private migrationBodyCache: { prefix: string; rowTemplate: string; suffix: string } | null = null;
  private manifestTemplateCache: string | null = null;
  private readonly ROW_TEMPLATE_START = '{{ROW_TEMPLATE_START}}';
  private readonly ROW_TEMPLATE_END = '{{ROW_TEMPLATE_END}}';


  constructor(
    private readonly asupStatsService: AsupStatsService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(AsupXmlGeneratorService.name);
  }

  /**
   * Load template file from templates dir. Caches after first load.
   */
  private async loadTemplate(filename: string): Promise<string> {
    const filepath = path.join(this.templatesDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    return content.trim();
  }

  /** Load and parse migration-body.xml.template into prefix (includes DOCTYPE), row template, suffix. */
  private async getMigrationProjectTemplate(): Promise<{
    prefix: string;
    rowTemplate: string;
    suffix: string;
  }> {
    if (this.migrationBodyCache) return this.migrationBodyCache;
    const content = await this.loadTemplate('migration-body.xml.template');
    const startIdx = content.indexOf(this.ROW_TEMPLATE_START);
    const endIdx = content.indexOf(this.ROW_TEMPLATE_END);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error(
        'migration-body.xml.template must contain {{ROW_TEMPLATE_START}} and {{ROW_TEMPLATE_END}}.',
      );
    }
    const prefix = content.substring(0, startIdx).trim();
    const rowTemplate = content
      .substring(startIdx + this.ROW_TEMPLATE_START.length, endIdx)
      .trim();
    const suffix = content.substring(endIdx + this.ROW_TEMPLATE_END.length).trim();
    this.migrationBodyCache = { prefix, rowTemplate, suffix };
    return this.migrationBodyCache;
  }


  /**
   * Build migration project XML for untransmitted records (for daily ASUP transmission).
   * Fetches untransmitted stats, fills the migration-body template, and returns the full XML.
   */
  async buildMigrationProjectXml(): Promise<string> {
    this.logger.log('Generating migration project XML for untransmitted records...');

    const projectStats = await this.asupStatsService.getUntransmittedStatsGroupedByProject();
    const colTimeUs = Math.floor(Date.now() * 1000).toString();
    const { prefix, rowTemplate, suffix } = await this.getMigrationProjectTemplate();

    const filledPrefix = prefix.replace(/\{\{COL_TIME_US\}\}/g, colTimeUs);

    let rows = '';
    for (const project of projectStats) {
      const firstJob = project.jobs[0];
      const source = firstJob?.sourceServerType || '';
      const destination = firstJob?.destinationServerType || '';
      const protocol = firstJob?.protocol || '';
      const hasDiscovery = project.jobs.some(j => j.jobType === 'discovery');
      const hasMigration = project.jobs.some(j => j.jobType === 'migration');
      const jobType = hasDiscovery && hasMigration ? 'mixed' : (firstJob?.jobType || 'unknown');

      rows += rowTemplate
        .replace(/\{\{COL_TIME_US\}\}/g, colTimeUs)
        .replace(/\{\{PROJECT_ID\}\}/g, this.escapeXml(project.projectId))
        .replace(/\{\{SOURCE\}\}/g, this.escapeXml(source))
        .replace(/\{\{DESTINATION\}\}/g, this.escapeXml(destination))
        .replace(/\{\{PROTOCOL\}\}/g, this.escapeXml(protocol))
        .replace(/\{\{JOB_TYPE\}\}/g, this.escapeXml(jobType))
        .replace(/\{\{DISCOVERED_SIZE\}\}/g, String(project.totals.discoveredSizeBytes))
        .replace(/\{\{MIGRATED_SIZE\}\}/g, String(project.totals.migratedSizeBytes))
        .replace(/\{\{DISCOVERED_FILECOUNT\}\}/g, String(project.totals.discoveredFileCount))
        .replace(/\{\{MIGRATED_FILECOUNT\}\}/g, String(project.totals.migratedFileCount ?? ''))
        .replace(/\{\{JOBRUN_COUNT\}\}/g, String(project.totals.totalJobRuns)) + '\n';
    }

    const xml = filledPrefix + '\n' + rows + suffix + '\n';
    this.logger.log(`Generated migration project XML: ${xml.length} bytes, ${projectStats.length} projects`);
    return xml;
  }


  /**
   * Load manifest.xml.template (lazy). Used for ASUP payload packaging.
   */
  private async getManifestTemplate(): Promise<string> {
    if (this.manifestTemplateCache) return this.manifestTemplateCache;
    this.manifestTemplateCache = await this.loadTemplate('manifest.xml.template');
    return this.manifestTemplateCache;
  }

  /**
   * Build manifest XML for the ASUP .7z payload.
   * Called by the packager with size metadata. Sequence is hardcoded in template.
   */
  async buildManifestXml(
    migrationXmlSize: number,
    collectionTimeMs: number,
    sizeCompressed: number,
  ): Promise<string> {
    const template = await this.getManifestTemplate();
    const colTimeUs = (Date.now() * 1000).toString();
    return template
      .replace(/\{\{COL_TIME_US\}\}/g, colTimeUs)
      .replace(/\{\{SIZE_COLLECTED\}\}/g, migrationXmlSize.toString())
      .replace(/\{\{TIME_COLLECTED_MS\}\}/g, collectionTimeMs.toString())
      .replace(/\{\{SIZE_COMPRESSED\}\}/g, sizeCompressed.toString());
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
