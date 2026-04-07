import { Injectable, Inject } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { AsupXmlGeneratorService } from './asup-xml-generator.service';
import { SerialIdSyncService } from '../serial-id-sync.service';

const sevenBin = require('7zip-bin');
const execFile = promisify(execFileCb);

const ISF_THRESHOLD_BYTES = 200 * 1024 * 1024; // 200 MB

/**
 * AsupPackagerService
 *
 * Handles ASUP payload packaging only (no XML generation):
 * 1. Get migration XML and manifest XML from AsupXmlGeneratorService
 * 2. Build x-header from template
 * 3. Compress migration XML, manifest XML, and x-headers into a .7z archive
 * 4. Calculate MD5 checksum and return path + HTTP headers for transmission
 */
@Injectable()
export class AsupPackagerService {
  private readonly logger: LoggerService;
  private readonly WORK_DIR = '/tmp/asup-packaging';
  private readonly ASUP_REPORTS_DIR = process.env.ASUP_REPORTS_DIR || '/tmp/asup-reports';
  private readonly XHEADERS_TEMPLATE_PATH = path.join(__dirname, 'templates', 'x-headers.template');
  private readonly SUPPORT_BUNDLE_XHEADERS_TEMPLATE_PATH = path.join(
    __dirname,
    'templates',
    'support-bundle-x-headers.template',
  );
  private xHeadersTemplate = '';
  private supportBundleXHeadersTemplate = '';

  constructor(
    private readonly asupXmlGeneratorService: AsupXmlGeneratorService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    private readonly serialIdSyncService: SerialIdSyncService,
  ) {
    this.logger = loggerFactory.create(AsupPackagerService.name);
    this.loadTemplates();
  }

  // ─── Main Packaging Pipeline ─────────────────────────────────

  async packageAsupPayload(): Promise<{
    archivePath: string;
    md5Checksum: string;
    headersMap: Record<string, string>;
    xmlContent: string;
  } | null> {
    this.logger.log('Starting ASUP payload packaging...');

    const serialId = await this.serialIdSyncService.getSerialId();
    if (!serialId) {
      this.logger.error('Serial ID not found — ASUP transmission aborted. Ensure the serial ID is initialised in the database or conf file.');
      return null;
    }

    // 1. Get migration XML from xml-generator
    const startTime = Date.now();
    const migrationXml = await this.asupXmlGeneratorService.buildMigrationProjectXml();
    const collectionTimeMs = Date.now() - startTime;
    const migrationXmlSize = Buffer.byteLength(migrationXml, 'utf-8');
    this.logger.log(`Migration XML from generator (${migrationXmlSize} bytes, ${collectionTimeMs}ms)`);

    // 2. Build x-header-data.txt first so its size is available for the manifest row
    const { headersText, headersMap } = this.buildXHeaders(this.xHeadersTemplate, serialId);
    const xHeaderSize = Buffer.byteLength(headersText, 'utf-8');
    this.logger.log(`Generated x-header-data.txt (${xHeaderSize} bytes)`);

    // 3. Get manifest XML with x-header size included
    const manifestXml = await this.asupXmlGeneratorService.buildManifestXml(
      migrationXmlSize,
      collectionTimeMs,
      migrationXmlSize,
      xHeaderSize,
    );
    this.logger.log(`Manifest XML from generator (${Buffer.byteLength(manifestXml, 'utf-8')} bytes)`);

    // 4. Write temp files and compress into .7z
    await fs.mkdir(this.WORK_DIR, { recursive: true });
    await fs.mkdir(this.ASUP_REPORTS_DIR, { recursive: true });

    const files = {
      migration: path.join(this.WORK_DIR, 'migration-projects.xml'),
      manifest: path.join(this.WORK_DIR, 'manifest.xml'),
      xHeader: path.join(this.WORK_DIR, 'x-header-data.txt'),
    };

    await Promise.all([
      fs.writeFile(files.migration, migrationXml, 'utf-8'),
      fs.writeFile(files.manifest, manifestXml, 'utf-8'),
      fs.writeFile(files.xHeader, headersText, 'utf-8'),
    ]);

    const archivePath = path.join(this.ASUP_REPORTS_DIR, 'asup-payload.7z');
    try { await fs.unlink(archivePath); } catch {  }

    try {
      await new Promise<void>((resolve, reject) => {
        execFileCb(
          sevenBin.path7za,
          ['a', archivePath, files.migration, files.manifest, files.xHeader],
          (err, _stdout, stderr) => {
            if (err) {
              reject({ error: err, stderr: stderr?.trim() });
            } else {
              resolve();
            }
          },
        );
      });
    } catch (failure: any) {
      const { error, stderr } = failure;
      this.logger.error(
        `Failed to create .7z archive: ${error.message}`,
        stderr ? `stderr: ${stderr}` : error.stack,
      );
      throw new Error(`7za failed: ${stderr || error.message}`);
    }

    this.logger.log(`Created .7z archive at ${archivePath}`);

    // 5. MD5 checksum
    const archiveBuffer = await fs.readFile(archivePath);
    const md5Checksum = crypto.createHash('md5').update(archiveBuffer).digest('hex');
    headersMap['X-Netapp-Asup-Payload-Checksum'] = md5Checksum;
    this.logger.log(`MD5 checksum = ${md5Checksum} (${archiveBuffer.length} bytes)`);

    // Cleanup temp files
    await Promise.all(
      Object.values(files).map(f => fs.unlink(f).catch(() => {})),
    );

    this.logger.log('ASUP payload packaging complete');
    return { archivePath, md5Checksum, headersMap, xmlContent: migrationXml };
  }

  async packageSupportBundlePayload(
    bundleFilename: string,
    bundleBuffer: Buffer,
  ): Promise<{
    archivePath: string;
    md5Checksum: string;
    headersMap: Record<string, string>;
    isLargePayload: boolean;
  }> {
    this.logger.log(`Starting support bundle ASUP packaging for ${bundleFilename}...`);
    const startTime = Date.now();
    await fs.mkdir(this.WORK_DIR, { recursive: true });
    await fs.mkdir(this.ASUP_REPORTS_DIR, { recursive: true });

    const safeBundleName = path.basename(bundleFilename || 'support-bundle.zip');
    const files = {
      bundle: path.join(this.WORK_DIR, safeBundleName),
      manifest: path.join(this.WORK_DIR, 'manifest.xml'),
      xHeader: path.join(this.WORK_DIR, 'x-header.txt'),
    };
    const extractedDir = path.join(this.WORK_DIR, `support-bundle-extracted-${Date.now()}`);
    const stagedPayloadDir = path.join(this.WORK_DIR, `support-bundle-staged-${Date.now()}`);

    let archivePath: string | undefined;
    let headersMap: Record<string, string> = {};
    try {
      await fs.writeFile(files.bundle, bundleBuffer);
      await this.extractZip(files.bundle, extractedDir);
      const bundledFiles = await this.collectExtractedFiles(extractedDir);
      await fs.mkdir(stagedPayloadDir, { recursive: true });

      const manifestEntries: Array<{ name: string; size: number }> = [];
      for (const file of bundledFiles) {
        const safeName = this.toFlatFilename(file.relativePath);
        await fs.copyFile(file.absolutePath, path.join(stagedPayloadDir, safeName));
        manifestEntries.push({ name: safeName, size: file.size });
      }

      const manifestXml = await this.asupXmlGeneratorService.buildSupportBundleManifestXml(
        manifestEntries,
        Date.now() - startTime,
      );
      const xHeaders = this.buildXHeaders(
        this.supportBundleXHeadersTemplate || this.xHeadersTemplate,
      );
      headersMap = xHeaders.headersMap;

      await Promise.all([
        fs.writeFile(files.manifest, manifestXml, 'utf-8'),
        fs.writeFile(files.xHeader, xHeaders.headersText, 'utf-8'),
      ]);
      await Promise.all([
        fs.copyFile(files.manifest, path.join(stagedPayloadDir, 'manifest.xml')),
        fs.copyFile(files.xHeader, path.join(stagedPayloadDir, 'x-header.txt')),
      ]);

      archivePath = path.join(this.ASUP_REPORTS_DIR, `support-bundle-asup-${Date.now()}.7z`);

    await execFile(sevenBin.path7za, ['a', archivePath, '.'], { cwd: stagedPayloadDir });

      let archiveBuffer = await fs.readFile(archivePath);
      const isLargePayload = archiveBuffer.length > ISF_THRESHOLD_BYTES;
      const archiveFilename = path.basename(archivePath);

      // ISF spec: X-Netapp-asup-large and X-Netapp-asup-large-filename must appear
      // in BOTH the Payload (x-header.txt inside .7z) and Transmission (HTTP headers).
      // We update x-header.txt inside the existing archive only when the payload is large.
      if (isLargePayload) {
        this.logger.log(
          `[packageSupportBundlePayload] Archive is ${(archiveBuffer.length / 1024 / 1024).toFixed(2)}MB` +
          ` > 200MB threshold — appending ISF fields to x-header.txt inside .7z`,
        );
        const isfXHeaderPath = path.join(stagedPayloadDir, 'x-header.txt');
        const existingXHeader = await fs.readFile(isfXHeaderPath, 'utf-8');
        const isfLines =
          `X-Netapp-asup-large: true\n` +
          `X-Netapp-asup-large-filename: ${archiveFilename}\n`;
        await fs.writeFile(isfXHeaderPath, existingXHeader.trimEnd() + '\n' + isfLines, 'utf-8');

        // Update only x-header.txt inside the existing .7z (avoids full recompression)
        await execFile(sevenBin.path7za, ['u', archivePath, 'x-header.txt'], {
          cwd: stagedPayloadDir,
        });

        // MD5 must be recomputed over the updated archive
        archiveBuffer = await fs.readFile(archivePath);
        this.logger.log(
          `[packageSupportBundlePayload] x-header.txt updated inside .7z with ISF fields`,
        );
      }

      const md5Checksum = crypto.createHash('md5').update(archiveBuffer).digest('hex');
      headersMap['X-Netapp-Asup-Payload-Checksum'] = md5Checksum;

      return { archivePath, md5Checksum, headersMap, isLargePayload };
    } catch (err) {
      this.logger.error(
        `[packageSupportBundlePayload] Packaging failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    } finally {
      // Always clean up temp files and dirs, regardless of success or failure.
      // Each cleanup is independent — a failure in one must not block the others.
      await Promise.all(
        Object.values(files).map((f) =>
          fs.unlink(f).catch((err: unknown) => {
            this.logger.warn(
              `[packageSupportBundlePayload] Failed to delete temp file ${f}: ${(err as Error).message}`,
            );
          }),
        ),
      );
      try {
        await fs.rm(extractedDir, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(
          `[packageSupportBundlePayload] Failed to remove extractedDir ${extractedDir}: ${(err as Error).message}`,
        );
      }
      try {
        await fs.rm(stagedPayloadDir, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(
          `[packageSupportBundlePayload] Failed to remove stagedPayloadDir ${stagedPayloadDir}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Templates ───────────────────────────────────────────────

  /** Load x-headers template once at startup. Manifest is built by xml-generator. */
  private async loadTemplates() {
    try {
      this.xHeadersTemplate = await fs.readFile(this.XHEADERS_TEMPLATE_PATH, 'utf-8');
      this.logger.log('Loaded ASUP x-headers template');
    } catch (error) {
      this.logger.error(`Failed to load ASUP x-headers template: ${(error as Error).message}`);
    }

    try {
      this.supportBundleXHeadersTemplate = await fs.readFile(
        this.SUPPORT_BUNDLE_XHEADERS_TEMPLATE_PATH,
        'utf-8',
      );
      this.logger.log('Loaded support bundle ASUP x-headers template');
    } catch (error) {
      this.logger.error(
        `Failed to load support bundle ASUP x-headers template: ${(error as Error).message}`,
      );
    }
  }

  // ─── X-Headers ────────────────────────────────────────────────

  private buildXHeaders(template: string, serialId = ''): {
    headersText: string;
    headersMap: Record<string, string>;
  } {
    const generatedOn = this.formatAsupDate(new Date());

    const headersText = template
      .replace(/\{\{GENERATED_ON\}\}/g, generatedOn)
      .replace(/\{\{SERIAL_NUM\}\}/g, serialId)
      .replace(/\{\{SYSTEM_ID\}\}/g, serialId);

    // Parse the text into a key-value map for HTTP headers
    const headersMap: Record<string, string> = {};
    for (const line of headersText.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        headersMap[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
      }
    }

    return { headersText, headersMap };
  }

  private async extractZip(zipPath: string, outputDir: string): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    // Use 7za (already bundled via 7zip-bin) instead of unzip to avoid the
    // "overlapped components (possible zip bomb)" false-positive from unzip 6.0
    // which rejects zip files created by Java/Node.js zip libraries.
    const sevenZaPath: string = sevenBin.path7za;
    await execFile(sevenZaPath, ['x', zipPath, `-o${outputDir}`, '-y']);
  }

  private async collectExtractedFiles(
    rootDir: string,
  ): Promise<Array<{ relativePath: string; absolutePath: string; size: number }>> {
    const files: Array<{ relativePath: string; absolutePath: string; size: number }> = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }
        const stat = await fs.stat(absolutePath);
        files.push({
          relativePath: path.relative(rootDir, absolutePath).replace(/\\/g, '/'),
          absolutePath,
          size: stat.size,
        });
      }
    };
    await walk(rootDir);
    return files;
  }

  private toFlatFilename(relativePath: string): string {
    // Strip the top-level bundle directory (e.g. "ndm_logs_<uuid>/"), then map
    // each file to a structured short name based on its path type:
    //
    // Log files (under ndm_logs/<date>/):
    //   control-plane service logs  → cp_<svc>_<YY_MM_DD>_<projectId>.log
    //   worker logs                 → worker_<workerId>_<YY_MM_DD>_<projectId>.log
    //   no-project worker logs      → no_project_worker_<workerId>_<YY_MM_DD>.log
    //
    // CSV files:
    //   Performance Metrics/  → perf_<metric>_<ts>.csv   (hyphens → underscores)
    //   State Data/           → state_data_<name>_<ts>.csv
    //   System Inventory/     → sys_inventory_<type>_<ts>.csv
    //   configuration data/   → <filename>  (no prefix)
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    // Strip the top-level UUID bundle directory
    const trimmed = parts.length > 1 ? parts.slice(1).join('/') : normalized;
    const tp = trimmed.split('/');

    /** Convert YYYY-MM-DD → YY_MM_DD (2-digit year, underscore separators) */
    const shortDate = (d: string) => d.replace(/-/g, '_').slice(2);

    /** Sanitize a string for use in a filename */
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

    // ── Log files under ndm_logs/<date>/... ─────────────────────────────────
    if (tp[0] === 'ndm_logs' && tp.length >= 3) {
      const dd = shortDate(tp[1]);   // YYYY-MM-DD → YY_MM_DD
      const projectOrNone = tp[2];   // <projectId> or "no-project"

      // no-project: ndm_logs/<date>/no-project/...
      if (projectOrNone === 'no-project') {
        const rest = tp.slice(3);
        if (rest[0] === 'worker' && rest.length >= 3) {
          const workerId = rest[1];
          const fname = rest.slice(2).join('/');
          if (fname === 'worker.log') return `no_project_worker_${workerId}_${dd}.log`;
          return `${dd}_no_project_worker_${workerId}_${safe(fname)}`;
        }
        return `${dd}_no_project_${safe(rest.join('_'))}`;
      }

      // project: ndm_logs/<date>/<projectId>/...
      const projectId = projectOrNone;
      const sub = tp.slice(3); // e.g. ["control-plane", "admin-service.log"]
      if (sub.length === 0) return safe(trimmed.replace(/\//g, '_'));

      const subDir = sub[0];

      // Control-plane service logs
      if (subDir === 'control-plane') {
        const fname = sub.slice(1).join('/');
        const cpMap: Record<string, string> = {
          'admin-service.log':   `cp_admin_svc_${dd}_${projectId}.log`,
          'config-service.log':  `cp_config_svc_${dd}_${projectId}.log`,
          'datamigrator-ui.log': `cp_datamigrator_ui_${dd}_${projectId}.log`,
          'db-writer.log':       `cp_db_writer_${dd}_${projectId}.log`,
          'jobs-service.log':    `cp_jobs_svc_${dd}_${projectId}.log`,
          'reports-service.log': `cp_reports_svc_${dd}_${projectId}.log`,
          'support-service.log': `cp_support_svc_${dd}_${projectId}.log`,
          'error-report.csv':    `cp_error_report_${dd}_${projectId}.csv`,
        };
        return cpMap[fname] ?? `cp_${dd}_${projectId}_${safe(fname)}`;
      }

      // Worker logs: ndm_logs/<date>/<projectId>/worker/<workerId>/...
      if (subDir === 'worker' && sub.length >= 3) {
        const workerId = sub[1];
        const fname = sub.slice(2).join('/');
        if (fname === 'worker.log') return `worker_${workerId}_${dd}_${projectId}.log`;
        return `${dd}_${projectId}_worker_${workerId}_${safe(fname)}`;
      }

      return safe(trimmed.replace(/\//g, '_'));
    }

    // ── Metrics / State / Inventory / Config CSV files ───────────────────────
    const dir = (tp[0] ?? '').toLowerCase();
    const fname = tp.slice(1).join('_');

    if (dir === 'performance metrics') {
      // "cpu-percent-<ts>.csv" → "perf_cpu_percent_<ts>.csv"
      return `perf_${safe(fname.replace(/-/g, '_'))}`;
    }
    if (dir === 'state data') {
      // "service_pods_<ts>.csv" → "state_data_service_pods_<ts>.csv"
      return `state_data_${safe(fname)}`;
    }
    if (dir === 'system inventory') {
      // "system-inventory-disk-usage-<ts>.csv" → "sys_inventory_disk_usage_<ts>.csv"
      const base = fname.replace(/^system-inventory-/, '').replace(/-/g, '_');
      return `sys_inventory_${safe(base)}`;
    }
    if (dir === 'configuration data') {
      // No category prefix — just the filename as-is
      return safe(fname);
    }

    // Fallback: flatten path separators and sanitize
    const fallback = trimmed.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    return fallback.length > 0 ? fallback : `file-${Date.now()}`;
  }

  /** Format date for ASUP x-headers (e.g. "Sun Jan 05 14:30:00 UTC 2025"). */
  private formatAsupDate(date: Date): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      year: 'numeric',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((p) => [p.type, p.value]),
    );
    return `${parts.weekday} ${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second} UTC ${parts.year}`;
  }
}
