import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DataSource } from 'typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const axios = require('axios');
import { AsupStatsService } from './asup-stats.service';
import { AsupPackagerService } from './asup-packager.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

const ASUP_ENABLED_KEY = 'asup_enabled';
const ASUP_TRANSMIT_MAX_RETRIES = 3;
const ASUP_TRANSMIT_RETRY_DELAY_MS = 3000;

export interface AsupSettingsData {
  enabled: boolean;
  lastUpdated?: string | null;
}

/**
 * AsupSchedulerService handles the DAILY automated transmission of ASUP metrics.
 * 
 * Features:
 * - Daily cron job (runs every day at midnight)
 * - Only transmits UNTRANSMITTED records from asup_stats table
 * - Marks records as transmitted after successful transmission
 * - Reads enable/disable settings from database (not in-memory)
 * - Generates XML and transmits to ASUP endpoint
 * - Logs transmission status
 * 
 * Transmission runs when ASUP_ENDPOINT_URL is set; otherwise payload is packaged but not sent.
 */
@Injectable()
export class AsupSchedulerService {
  private readonly logger: LoggerService;
  private readonly dbSchema = process.env.SCHEMA || 'datamigrator';

  /** ASUP endpoint URL from env ASUP_ENDPOINT_URL. */
  private readonly asupEndpointUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly asupStatsService: AsupStatsService,
    private readonly asupPackagerService: AsupPackagerService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(AsupSchedulerService.name);
    } else {
      this.logger = new Logger(AsupSchedulerService.name) as any;
    }

    this.asupEndpointUrl = this.configService.get<string>('app.asup.asupEndpoint');

    this.logger.log('ASUP Scheduler Service initialized');
  }

  // ─── ASUP settings (global_settings table) ─────────────────────

  async getAsupSettings(): Promise<AsupSettingsData> {
    try {
      const result = await this.dataSource.query(
        `SELECT setting_key, setting_value, updated_at FROM ${this.dbSchema}.global_settings WHERE setting_key = $1`,
        [ASUP_ENABLED_KEY]
      );
      let enabled = false;
      let lastUpdated: string | null = null;
      for (const row of result) {
        if (row.setting_key === ASUP_ENABLED_KEY) {
          enabled = row.setting_value === 'true';
          lastUpdated = row.updated_at?.toISOString?.() ?? row.updated_at ?? null;
          break;
        }
      }
      return { enabled, lastUpdated };
    } catch (error) {
      this.logger.error(`Failed to get ASUP settings: ${error.message}`);
      return { enabled: false, lastUpdated: null };
    }
  }

  async updateAsupSettings(enabled: boolean, userId?: string): Promise<AsupSettingsData> {
    try {
      await this.dataSource.query(
        `UPDATE ${this.dbSchema}.global_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2::uuid WHERE setting_key = $3`,
        [String(enabled), userId ?? null, ASUP_ENABLED_KEY]
      );
      this.logger.log(`ASUP settings updated: enabled=${enabled}`);
      return this.getAsupSettings();
    } catch (error) {
      this.logger.error(`Failed to update ASUP settings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Daily cron job to transmit ASUP metrics
   * Runs every day at midnight (00:00)
   * 
   * This job:
   * 1. Checks if ASUP is enabled in the database
   * 2. Generates XML from UNTRANSMITTED records in asup_stats table
   * 3. Transmits to ASUP endpoint via HTTP PUT (when configured)
   * 4. Marks transmitted records as 'transmitted = TRUE'
   * 5. Updates last transmission timestamp
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleAsupTransmission() {
    this.logger.log('Daily ASUP transmission job triggered');
    
    try {

      const settings = await this.getAsupSettings();

      if (!settings.enabled) {
        this.logger.log('ASUP is disabled in database, skipping transmission');
        return;
      }

      // Check how many untransmitted records we have
      const untransmittedCount = await this.asupStatsService.getUntransmittedCount();
      this.logger.log(`Found ${untransmittedCount} untransmitted ASUP stats records`);
      
      if (untransmittedCount === 0) {
        this.logger.log('No untransmitted records to send, skipping transmission');
        return;
      }

      this.logger.log('ASUP is enabled, starting metrics transmission...');
      await this.transmitAsupMetrics();
      
    } catch (error) {
      this.logger.error(`Daily ASUP transmission failed: ${error.message}`);
    }
  }

  /**
   * Transmit ASUP metrics to the configured endpoint
   * 
   * This method:
   * 1. Generates XML from UNTRANSMITTED records in asup_stats table
   * 2. Sends to ASUP endpoint via HTTP PUT (when configured)
   * 3. Marks records as transmitted after successful transmission
   * 4. Updates last transmission timestamp in database
   * 
   * If ASUP_ENDPOINT_URL is not set, payload is packaged but not transmitted.
   */
  async transmitAsupMetrics(): Promise<void> {
    this.logger.log('Starting ASUP payload packaging (via asup-packager)...');

    const payload = await this.asupPackagerService.packageAsupPayload();
    if (!payload) {
      return;
    }
    const { archivePath, md5Checksum, headersMap } = payload;
    this.logger.log(`Packaged ASUP payload: ${archivePath}, MD5=${md5Checksum}`);

    if (!this.asupEndpointUrl) {
      this.logger.error('ASUP endpoint not set - payload packaged but not transmitted');
      return;
    }

    const archiveFilename = path.basename(archivePath);
    const requestUrl = `${this.asupEndpointUrl.replace(/\/$/, '')}/${archiveFilename}`;
    this.logger.log(`Transmitting ASUP .7z payload to: ${requestUrl}`);
    const archiveBuffer = await fs.readFile(archivePath);
    const putOptions = {
      headers: {
        'Content-Type': 'application/x-7z-compressed',
        'X-ASUP-Source': 'NDM',
        'X-ASUP-Version': '1.3',
        'X-Netapp-Asup-Payload-Checksum': md5Checksum,
        ...headersMap,
      },
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    };

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= ASUP_TRANSMIT_MAX_RETRIES; attempt++) {
      try {
        await axios.put(requestUrl, archiveBuffer, putOptions);
        this.logger.log('ASUP transmission completed');
        lastError = null;
        break;
      } catch (err) {
        lastError = err as Error;
        this.logger.error(
          `ASUP transmission attempt ${attempt}/${ASUP_TRANSMIT_MAX_RETRIES} failed: ${lastError.message}`,
          lastError.stack,
        );
        if (attempt < ASUP_TRANSMIT_MAX_RETRIES) {
          this.logger.log(`Retrying in ${ASUP_TRANSMIT_RETRY_DELAY_MS}ms...`);
          await new Promise((resolve) => setTimeout(resolve, ASUP_TRANSMIT_RETRY_DELAY_MS));
        }
      }
    }
    if (lastError) {
      throw lastError;
    }

    const recordsMarked = await this.asupStatsService.markAsTransmitted();
    this.logger.log(`Marked ${recordsMarked} records as transmitted`);
  }
}