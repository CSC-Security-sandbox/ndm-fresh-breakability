import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomInt } from 'crypto';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

const SERIAL_ID_CONF_PATH = '/opt/datamigrator/conf/serial_id.conf';
const SERIAL_ID_SETTING_KEY = 'ndm_serial_id';
const MAX_DB_RETRIES = 10;
const DB_RETRY_DELAY_MS = 5000;
const SERIAL_REGEX = /^975[0-9]{17}$/;

@Injectable()
export class SerialIdSyncService implements OnApplicationBootstrap {
  private readonly logger: LoggerService;
  private readonly dbSchema = process.env.SCHEMA || 'datamigrator';

  constructor(
    private readonly dataSource: DataSource,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory,
  ) {
    this.logger = loggerFactory
      ? loggerFactory.create(SerialIdSyncService.name)
      : (new Logger(SerialIdSyncService.name) as any);
  }

  async onApplicationBootstrap(): Promise<void> {
    const dbSerial = await this.readSerialIdFromDb();
    if (dbSerial) {
      this.logger.log(`Serial ID already in DB (...${dbSerial.slice(-4)}); mirroring to conf file.`);
      await this.writeSerialIdToFile(dbSerial);
      return;
    }

    const fileSerial = await this.readSerialIdFromFile();
    const candidate = fileSerial ?? this.generateSerialId();

    if (fileSerial) {
      this.logger.log(`Serial ID found in conf file (...${fileSerial.slice(-4)}); syncing to DB.`);
    } else {
      this.logger.log(`No serial ID found; generated new one (...${candidate.slice(-4)}).`);
    }

    const synced = await this.upsertSerialIdWithRetry(candidate);
    if (!synced) {
      this.logger.error('Serial ID DB sync failed after retries; will retry on next service restart.');
    }

    await this.writeSerialIdToFile(candidate);
    this.logger.log(`Serial ID lifecycle complete (...${candidate.slice(-4)}).`);
  }

  private generateSerialId(): string {
    // Format: 975 + 00 + YYMMDDHHMM (UTC) + 0 + 4 random digits = 20 digits total
    const now = new Date();
    const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
    const yy = pad(now.getUTCFullYear() % 100);
    const mm = pad(now.getUTCMonth() + 1);
    const dd = pad(now.getUTCDate());
    const hh = pad(now.getUTCHours());
    const min = pad(now.getUTCMinutes());
    const rand = pad(randomInt(10000), 4);
    return `97500${yy}${mm}${dd}${hh}${min}0${rand}`;
  }

  private async readSerialIdFromDb(): Promise<string | null> {
    try {
      const rows: Array<{ setting_value: string; serial_id: string }> =
        await this.dataSource.query(
          `SELECT setting_value, serial_id FROM ${this.dbSchema}.global_settings WHERE setting_key = $1`,
          [SERIAL_ID_SETTING_KEY],
        );
      if (!rows?.length) return null;
      const candidate = rows[0].serial_id || rows[0].setting_value;
      return candidate && SERIAL_REGEX.test(candidate) ? candidate : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read serial ID from DB: ${message}`);
      return null;
    }
  }

  private async readSerialIdFromFile(): Promise<string | null> {
    try {
      const content = await fs.readFile(SERIAL_ID_CONF_PATH, 'utf-8');
      const match = content.match(/^\s*serial_id=(975[0-9]{17})\s*$/m);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private async writeSerialIdToFile(serialId: string): Promise<void> {
    try {
      await fs.mkdir(dirname(SERIAL_ID_CONF_PATH), { recursive: true });
      await fs.writeFile(SERIAL_ID_CONF_PATH, `serial_id=${serialId}\n`, 'utf-8');
      this.logger.log('Serial ID mirrored to conf file.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to write serial ID to conf file (best-effort): ${message}`);
    }
  }

  private async upsertSerialIdWithRetry(serialId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt += 1) {
      try {
        await this.dataSource.query(
          `INSERT INTO ${this.dbSchema}.global_settings (setting_key, setting_value, serial_id, description, setting_type)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (setting_key) DO NOTHING`,
          [
            SERIAL_ID_SETTING_KEY,
            serialId,
            serialId,
            'NDM product serial identifier',
            'SYSTEM',
          ],
        );
        this.logger.log(`Serial ID upserted (attempt ${attempt}, ...${serialId.slice(-4)}).`);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Serial ID DB sync attempt ${attempt}/${MAX_DB_RETRIES} failed: ${message}`);
        if (attempt < MAX_DB_RETRIES) {
          await new Promise<void>((resolve) => setTimeout(resolve, DB_RETRY_DELAY_MS));
        }
      }
    }
    return false;
  }
}
