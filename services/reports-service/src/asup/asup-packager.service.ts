import { Injectable, Inject } from '@nestjs/common';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
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

const ISF_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

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

    // 3. Write content files and create initial .7z (without manifest)
    await fs.mkdir(this.WORK_DIR, { recursive: true });
    await fs.mkdir(this.ASUP_REPORTS_DIR, { recursive: true });

    const files = {
      migration: path.join(this.WORK_DIR, 'migration-projects.xml'),
      manifest: path.join(this.WORK_DIR, 'manifest.xml'),
      xHeader: path.join(this.WORK_DIR, 'x-header-data.txt'),
    };

    await Promise.all([
      fs.writeFile(files.migration, migrationXml, 'utf-8'),
      fs.writeFile(files.xHeader, headersText, 'utf-8'),
    ]);

    const archivePath = path.join(this.ASUP_REPORTS_DIR, 'asup-payload.7z');
    try { await fs.unlink(archivePath); } catch {  }

    // First pass: compress migration XML + x-header (no manifest yet)
    await this.run7za(['a', archivePath, files.migration, files.xHeader]);
    this.logger.log('Created initial .7z (migration-projects.xml + x-header-data.txt)');

    // 4. Read actual compressed sizes from the archive
    const compressedSizes = await this.readCompressedSizes(archivePath);
    const migrationCompressed = compressedSizes.get('migration-projects.xml') ?? migrationXmlSize;
    const xHeaderCompressed = compressedSizes.get('x-header-data.txt') ?? xHeaderSize;
    this.logger.log(
      `Compressed sizes: migration-projects.xml=${migrationCompressed}, x-header-data.txt=${xHeaderCompressed}`,
    );

    // 5. Generate manifest XML with actual compressed sizes
    const manifestXml = await this.asupXmlGeneratorService.buildManifestXml(
      migrationXmlSize,
      collectionTimeMs,
      migrationCompressed,
      xHeaderSize,
      0,
      xHeaderCompressed,
    );
    this.logger.log(`Manifest XML from generator (${Buffer.byteLength(manifestXml, 'utf-8')} bytes)`);

    // 6. Add manifest.xml into the existing archive (second pass)
    await fs.writeFile(files.manifest, manifestXml, 'utf-8');
    await this.run7za(['a', archivePath, files.manifest]);

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
    bundlePath: string,
  ): Promise<{
    archivePath: string;
    md5Checksum: string;
    headersMap: Record<string, string>;
    isLargePayload: boolean;
  }> {
    this.logger.log(`Starting support bundle ASUP packaging for ${bundleFilename} from ${bundlePath}...`);
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
      await fs.copyFile(bundlePath, files.bundle);
      await this.extractZip(files.bundle, extractedDir);
      const bundledFiles = await this.collectExtractedFiles(extractedDir);
      await fs.mkdir(stagedPayloadDir, { recursive: true });

      const manifestEntries: Array<{ name: string; size: number }> = [];
      for (const file of bundledFiles) {
        const safeName = this.toFlatFilename(file.relativePath);
        await fs.copyFile(file.absolutePath, path.join(stagedPayloadDir, safeName));
        manifestEntries.push({ name: safeName, size: file.size });
      }

      const serialId = (await this.serialIdSyncService.getSerialId()) ?? '';
      const xHeaders = this.buildXHeaders(
        this.supportBundleXHeadersTemplate || this.xHeadersTemplate,
        serialId,
      );
      headersMap = xHeaders.headersMap;
      const xHeaderSize = Buffer.byteLength(xHeaders.headersText, 'utf-8');

      const manifestXml = await this.asupXmlGeneratorService.buildSupportBundleManifestXml(
        manifestEntries,
        Date.now() - startTime,
        xHeaderSize,
      );

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

      const archiveStat = await fs.stat(archivePath);
      const isLargePayload = archiveStat.size > ISF_THRESHOLD_BYTES;
      const archiveFilename = path.basename(archivePath);

      // ISF spec: X-Netapp-asup-large and X-Netapp-asup-large-filename must appear
      // in BOTH the Payload (x-header.txt inside .7z) and Transmission (HTTP headers).
      // We update x-header.txt inside the existing archive only when the payload is large.
      if (isLargePayload) {
        this.logger.log(
          `[packageSupportBundlePayload] Archive is ${(archiveStat.size / 1024 / 1024).toFixed(2)}MB` +
          ` > 100MB threshold — appending ISF fields to x-header.txt inside .7z`,
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

        this.logger.log(
          `[packageSupportBundlePayload] x-header.txt updated inside .7z with ISF fields`,
        );
      }

      const md5Checksum = await this.computeStreamingMd5(archivePath);
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
    // each file to a structured short name based on its path type.
    //
    // All output filenames begin with <YY_MM_DD>_ (date-first ordering).
    //
    // Log files (under ndm_logs/<date>/):
    //   control-plane service logs  → <YY_MM_DD>_cp_<svc>_<projectId>.log
    //   worker logs                 → <YY_MM_DD>_worker_<workerId>_<projectId>.log
    //   no-project worker logs      → <YY_MM_DD>_no_project_worker_<workerId>.log
    //   no-project cp logs          → <YY_MM_DD>_no_project_cp_<svc>.log
    //
    // CSV files (epoch-ms timestamp converted to <YY_MM_DD>, stripped from end):
    //   Performance Metrics/  → <YY_MM_DD>_perf_<metric>.csv
    //   State Data/           → <YY_MM_DD>_state_data_<name>.csv
    //   System Inventory/     → <YY_MM_DD>_sys_inventory_<type>.csv
    //   configuration data/   → <YY_MM_DD>_<filename>.csv
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');

    // Strip the top-level UUID bundle directory
    const trimmed = parts.length > 1 ? parts.slice(1).join('/') : normalized;
    const tp = trimmed.split('/');

    /** Convert YYYY-MM-DD → YY_MM_DD (2-digit year, underscore separators) */
    const shortDate = (d: string) => d.replace(/-/g, '_').slice(2);

    /** Sanitize a string for use in a filename */
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

    /**
     * Strip a trailing 13-digit epoch-ms timestamp from a bare stem (no extension),
     * convert it to YY_MM_DD, and return both the cleaned stem and the date.
     * e.g. "cpu_percent_1775624021419" → { stem: "cpu_percent", date: "26_04_08" }
     * Falls back to today's UTC date when no timestamp is found.
     */
    const stripTimestamp = (stem: string): { stem: string; date: string } => {
      const toYYMMDD = (d: Date) => {
        const yy = String(d.getUTCFullYear()).slice(2);
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dy = String(d.getUTCDate()).padStart(2, '0');
        return `${yy}_${mo}_${dy}`;
      };
      const m = stem.match(/^(.*?)_(\d{13})$/);
      if (m) return { stem: m[1], date: toYYMMDD(new Date(parseInt(m[2], 10))) };
      return { stem, date: toYYMMDD(new Date()) };
    };

    // ── Log files under ndm_logs/<date>/... ─────────────────────────────────
    if (tp[0] === 'ndm_logs' && tp.length >= 3) {
      const dd = shortDate(tp[1]);   // YYYY-MM-DD → YY_MM_DD
      const projectOrNone = tp[2];   // <projectId> or "no-project"

      // no-project: ndm_logs/<date>/no-project/...
      if (projectOrNone === 'no-project') {
        const rest = tp.slice(3);

        // no-project worker logs
        if (rest[0] === 'worker' && rest.length >= 3) {
          const workerId = rest[1];
          const fname = rest.slice(2).join('/');
          if (fname === 'worker.log') return `no_project_worker_${workerId}_${dd}.log`;
          return `no_project_worker_${workerId}_${safe(fname)}_${dd}`;
        }

        // no-project control-plane logs
        if (rest[0] === 'control-plane' && rest.length >= 2) {
          const fname = rest.slice(1).join('/');
          const cpMap: Record<string, string> = {
            'admin-service.log':   `no_project_cp_admin_svc_${dd}.log`,
            'config-service.log':  `no_project_cp_config_svc_${dd}.log`,
            'datamigrator-ui.log': `no_project_cp_datamigrator_ui_${dd}.log`,
            'db-migrations.log':   `no_project_cp_db_migrations_${dd}.log`,
            'db-writer.log':       `no_project_cp_db_writer_${dd}.log`,
            'jobs-service.log':    `no_project_cp_jobs_svc_${dd}.log`,
            'reports-service.log': `no_project_cp_reports_svc_${dd}.log`,
            'support-service.log': `no_project_cp_support_svc_${dd}.log`,
            'error-report.csv':    `no_project_cp_error_report_${dd}.csv`,
          };
          return cpMap[fname] ?? `no_project_cp_${safe(fname)}_${dd}`;
        }

        return `no_project_${safe(rest.join('_'))}_${dd}`;
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
          'admin-service.log':   `cp_admin_svc_${projectId}_${dd}.log`,
          'config-service.log':  `cp_config_svc_${projectId}_${dd}.log`,
          'datamigrator-ui.log': `cp_datamigrator_ui_${projectId}_${dd}.log`,
          'db-migrations.log':   `cp_db_migrations_${projectId}_${dd}.log`,
          'db-writer.log':       `cp_db_writer_${projectId}_${dd}.log`,
          'jobs-service.log':    `cp_jobs_svc_${projectId}_${dd}.log`,
          'reports-service.log': `cp_reports_svc_${projectId}_${dd}.log`,
          'support-service.log': `cp_support_svc_${projectId}_${dd}.log`,
          'error-report.csv':    `cp_error_report_${projectId}_${dd}.csv`,
        };
        return cpMap[fname] ?? `cp_${projectId}_${safe(fname)}_${dd}`;
      }

      // Worker logs: ndm_logs/<date>/<projectId>/worker/<workerId>/...
      if (subDir === 'worker' && sub.length >= 3) {
        const workerId = sub[1];
        const fname = sub.slice(2).join('/');
        if (fname === 'worker.log') return `worker_${workerId}_${projectId}_${dd}.log`;
        return `${projectId}_worker_${workerId}_${safe(fname)}_${dd}`;
      }

      return safe(trimmed.replace(/\//g, '_'));
    }

    // ── Metrics / State / Inventory / Config CSV files ───────────────────────
    // Epoch-ms timestamps embedded in filenames are converted to YY_MM_DD and
    // moved to the end; the raw epoch is stripped.
    const dir = (tp[0] ?? '').toLowerCase();
    const rawFname = tp.slice(1).join('_');

    if (dir === 'performance metrics') {
      // "cpu-percent-1775624021419.csv" → "perf_cpu_percent_26_04_08.csv"
      const { stem, date } = stripTimestamp(
        rawFname.replace(/-/g, '_').replace(/\.csv$/i, ''),
      );
      return `perf_${safe(stem)}_${date}.csv`;
    }
    if (dir === 'state data') {
      // "service_pods_1775624017567.csv" → "state_data_service_pods_26_04_08.csv"
      const { stem, date } = stripTimestamp(rawFname.replace(/\.csv$/i, ''));
      return `state_data_${safe(stem)}_${date}.csv`;
    }
    if (dir === 'system inventory') {
      // "system-inventory-disk-usage-1775624022171.csv" → "sys_inventory_disk_usage_26_04_08.csv"
      const base = rawFname
        .replace(/^system-inventory-/i, '')
        .replace(/-/g, '_')
        .replace(/\.csv$/i, '');
      const { stem, date } = stripTimestamp(base);
      return `sys_inventory_${safe(stem)}_${date}.csv`;
    }
    if (dir === 'configuration data') {
      // "job_config_details_1775624017276.csv" → "job_config_details_26_04_08.csv"
      const { stem, date } = stripTimestamp(rawFname.replace(/\.csv$/i, ''));
      return `${safe(stem)}_${date}.csv`;
    }

    // Fallback: flatten path separators and sanitize
    const fallback = trimmed.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    return fallback.length > 0 ? fallback : `file-${Date.now()}`;
  }

  private async run7za(args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFile(sevenBin.path7za, args);
    } catch (err: any) {
      const subCmd = args[0] ?? '?';
      const stderr: string = err.stderr ?? '';
      const detail = stderr || err.message;
      this.logger.error(`7za ${subCmd} failed: ${err.message}`, detail);
      throw new Error(`7za ${subCmd} failed: ${detail}`);
    }
  }

  private async readCompressedSizes(archivePath: string): Promise<Map<string, number>> {
    const { stdout } = await execFile(sevenBin.path7za, ['l', '-slt', archivePath]);
    const sizes = new Map<string, number>();
    let currentPath = '';
    for (const line of stdout.split('\n')) {
      const t = line.trim();
      if (t.startsWith('Path = ')) {
        currentPath = t.slice(7).trim();
      } else if (t.startsWith('Packed Size = ') && currentPath) {
        const v = parseInt(t.slice(14).trim(), 10);
        if (!isNaN(v)) sizes.set(currentPath, v);
      }
    }
    return sizes;
  }

  /** Compute MD5 checksum by streaming the file in chunks instead of loading it entirely into memory. */
  private computeStreamingMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
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
