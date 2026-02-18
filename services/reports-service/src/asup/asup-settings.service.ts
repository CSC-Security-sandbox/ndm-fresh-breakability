import { Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

export interface AsupSettingsData {
  enabled: boolean;
  consentGiven: boolean;
  lastUpdated: string | null;
  lastTransmission: string | null;
}

const ASUP_ENABLED_KEY = 'asup_enabled';
const ASUP_LAST_TRANSMISSION_KEY = 'asup_last_transmission';

/**
 * Service for managing ASUP settings in the database.
 * 
 * ASUP settings are stored in the global_settings table:
 * - asup_enabled: true/false - set by instance creator on first login
 * - asup_last_transmission: ISO timestamp of last ASUP transmission
 * 
 * The instance creator sets the initial value via the Keycloak profile page.
 * Any App Admin can toggle the setting via the NDM UI.
 */
@Injectable()
export class AsupSettingsService {
  private readonly logger: LoggerService;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create(AsupSettingsService.name);
  }

  /**
   * Get the current ASUP settings from the database.
   */
  async getSettings(): Promise<AsupSettingsData> {
    try {
      const result = await this.dataSource.query(
        `SELECT setting_key, setting_value, updated_at 
         FROM datamigrator.global_settings 
         WHERE setting_key IN ($1, $2)`,
        [ASUP_ENABLED_KEY, ASUP_LAST_TRANSMISSION_KEY]
      );

      let enabled = false;
      let lastUpdated: string | null = null;
      let lastTransmission: string | null = null;

      for (const row of result) {
        if (row.setting_key === ASUP_ENABLED_KEY) {
          enabled = row.setting_value === 'true';
          lastUpdated = row.updated_at?.toISOString?.() || row.updated_at || null;
        } else if (row.setting_key === ASUP_LAST_TRANSMISSION_KEY) {
          lastTransmission = row.setting_value;
        }
      }

      return {
        enabled,
        consentGiven: enabled, // consent is implied by enabled being true
        lastUpdated,
        lastTransmission,
      };
    } catch (error) {
      this.logger.error(`Failed to get ASUP settings: ${error.message}`);
      // Return defaults on error
      return {
        enabled: false,
        consentGiven: false,
        lastUpdated: null,
        lastTransmission: null,
      };
    }
  }

  /**
   * Update ASUP settings in the database.
   * Can be called by App Admins from the NDM UI.
   */
  async updateSettings(
    enabled: boolean,
    userId?: string
  ): Promise<AsupSettingsData> {
    try {
      // Use UPSERT to insert or update
      await this.dataSource.query(
        `INSERT INTO datamigrator.global_settings (setting_key, setting_value, description, setting_type, updated_by)
         VALUES ($1, $2, 'ASUP metrics sharing enabled/disabled', 'boolean', $3::uuid)
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3::uuid`,
        [ASUP_ENABLED_KEY, String(enabled), userId || null]
      );

      this.logger.log(`ASUP settings updated: enabled=${enabled}`);

      return this.getSettings();
    } catch (error) {
      this.logger.error(`Failed to update ASUP settings: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update the last transmission timestamp.
   * Called after successful ASUP transmission.
   */
  async updateLastTransmission(): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      await this.dataSource.query(
        `INSERT INTO datamigrator.global_settings (setting_key, setting_value, description, setting_type)
         VALUES ($1, $2, 'Last ASUP transmission timestamp', 'timestamp')
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP`,
        [ASUP_LAST_TRANSMISSION_KEY, timestamp]
      );

      this.logger.log(`ASUP last transmission updated: ${timestamp}`);
    } catch (error) {
      this.logger.error(`Failed to update last transmission: ${error.message}`);
    }
  }
}
