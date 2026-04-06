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

const Seven = require('node-7z');
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
  }> {
    this.logger.log('Starting ASUP payload packaging...');

    // 1. Get migration XML from xml-generator
    const startTime = Date.now();
    const migrationXml = await this.asupXmlGeneratorService.buildMigrationProjectXml();
    const collectionTimeMs = Date.now() - startTime;
    const migrationXmlSize = Buffer.byteLength(migrationXml, 'utf-8');
    this.logger.log(`Migration XML from generator (${migrationXmlSize} bytes, ${collectionTimeMs}ms)`);

    // 2. Get manifest XML from xml-generator
    const manifestXml = await this.asupXmlGeneratorService.buildManifestXml(
      migrationXmlSize,
      collectionTimeMs,
      migrationXmlSize,
    );
    this.logger.log(`Manifest XML from generator (${Buffer.byteLength(manifestXml, 'utf-8')} bytes)`);

    // 3. Build x-header.txt + HTTP headers map
    const { headersText, headersMap } = this.buildXHeaders(this.xHeadersTemplate);
    this.logger.log(`Generated x-header.txt (${Buffer.byteLength(headersText, 'utf-8')} bytes)`);

    // 4. Write temp files and compress into .7z
    await fs.mkdir(this.WORK_DIR, { recursive: true });
    await fs.mkdir(this.ASUP_REPORTS_DIR, { recursive: true });

    const files = {
      migration: path.join(this.WORK_DIR, 'migration-projects.xml'),
      manifest: path.join(this.WORK_DIR, 'manifest.xml'),
      xHeader: path.join(this.WORK_DIR, 'x-header.txt'),
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
        const stream = Seven.add(archivePath, [
          files.migration, files.manifest, files.xHeader,
        ], { $bin: sevenBin.path7za });
        stream.on('end', () => resolve());
        stream.on('error', (err: Error) => reject(err));
      });
    } catch (err) {
      this.logger.error(
        `Failed to create .7z archive: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
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
    const { headersText, headersMap } = this.buildXHeaders(
      this.supportBundleXHeadersTemplate || this.xHeadersTemplate,
    );

    await Promise.all([
      fs.writeFile(files.manifest, manifestXml, 'utf-8'),
      fs.writeFile(files.xHeader, headersText, 'utf-8'),
    ]);
    await Promise.all([
      fs.copyFile(files.manifest, path.join(stagedPayloadDir, 'manifest.xml')),
      fs.copyFile(files.xHeader, path.join(stagedPayloadDir, 'x-header.txt')),
    ]);

    const archivePath = path.join(this.ASUP_REPORTS_DIR, `support-bundle-asup-${Date.now()}.7z`);

    await new Promise<void>((resolve, reject) => {
      const stream = Seven.add(
        archivePath,
        [path.join(stagedPayloadDir, '*')],
        { $bin: sevenBin.path7za },
      );
      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });

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

    // Staged dir must be cleaned up AFTER the ISF update above
    await Promise.all(
      Object.values(files).map((f) => fs.unlink(f).catch(() => {})),
    );
    await fs.rm(extractedDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(stagedPayloadDir, { recursive: true, force: true }).catch(() => {});

    return { archivePath, md5Checksum, headersMap, isLargePayload };
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

  private buildXHeaders(template: string): {
    headersText: string;
    headersMap: Record<string, string>;
  } {
    const generatedOn = this.formatAsupDate(new Date());

    const headersText = template
      .replace(/\{\{GENERATED_ON\}\}/g, generatedOn);

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
    // Strip the top-level bundle directory (e.g. "ndm_logs_<uuid>/") before flattening.
    // The zip file extracted from the support bundle always has a single top-level
    // directory named after the bundle (e.g. "ndm_logs_fb192415-3a7c-46cb-bb05-736d5e1df343").
    // That prefix is redundant inside the ASUP archive — all files already belong to the
    // same bundle — so we drop it to keep ASUP filenames short and readable.
    //
    // Abbreviations applied to shorten filenames:
    //   - "control-plane"  →  "cp"
    //   - "service"        →  "svc"  (e.g. admin-service → admin-svc, service-latency → svc-latency)
    //   - path "/" separator → "_"   (single underscore, not double, to keep names compact)
    //
    // e.g. "ndm_logs_<uuid>/ndm_logs/2026-04-05/<projectId>/control-plane/admin-service.log"
    //   →  "ndm_logs_2026-04-05_<projectId>_cp_admin-svc.log"
    const normalized = relativePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const trimmed = parts.length > 1 ? parts.slice(1).join('/') : normalized;
    const abbreviated = trimmed
      .replace(/control-plane/g, 'cp')
      .replace(/service/g, 'svc');
    const safe = abbreviated.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe.length > 0 ? safe : `file-${Date.now()}`;
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
