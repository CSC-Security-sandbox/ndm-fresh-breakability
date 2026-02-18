import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AsupService } from './asup.service';
import { AsupSettingsService } from './asup-settings.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

/**
 * AsupSchedulerService handles the weekly automated transmission of ASUP metrics.
 * 
 * Features:
 * - Weekly cron job (runs every Sunday at midnight)
 * - Reads enable/disable settings from database (not in-memory)
 * - Generates XML and transmits to ASUP endpoint
 * - Logs transmission status
 * - Includes deleted job metrics in weekly report
 * 
 * NOTE: ASUP transmission is currently DISABLED for local testing.
 * The scheduler will generate XML but not send it anywhere.
 * When ASUP endpoint is ready, uncomment the transmission code.
 */
@Injectable()
export class AsupSchedulerService {
  private readonly logger: LoggerService;
  
  // ASUP endpoint URL (to be configured when available)
  private readonly asupEndpointUrl: string | undefined;

  constructor(
    private readonly asupService: AsupService,
    private readonly asupSettingsService: AsupSettingsService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(AsupSchedulerService.name);
    } else {
      this.logger = new Logger(AsupSchedulerService.name) as any;
    }
    
    // Read ASUP endpoint URL from environment (will be undefined for local testing)
    this.asupEndpointUrl = process.env.ASUP_ENDPOINT_URL;
    
    this.logger.log('ASUP Scheduler Service initialized');
    if (this.asupEndpointUrl) {
      this.logger.log(`ASUP endpoint configured: ${this.asupEndpointUrl}`);
    } else {
      this.logger.log('ASUP endpoint not configured - transmission disabled');
    }
  }

  /**
   * Weekly cron job to transmit ASUP metrics
   * Runs every Sunday at midnight (00:00)
   * 
   * This job:
   * 1. Checks if ASUP is enabled in the database
   * 2. Generates migration analysis metrics (including deleted jobs)
   * 3. Converts to XML format
   * 4. Transmits to ASUP endpoint (when configured)
   * 5. Updates last transmission timestamp
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyAsupTransmission() {
    this.logger.log('Weekly ASUP transmission job triggered');
    
    try {
      // Read settings from database (NOT in-memory)
      const settings = await this.asupSettingsService.getSettings();
      
      // Check if ASUP is enabled
      if (!settings.enabled) {
        this.logger.log('ASUP is disabled in database, skipping transmission');
        return;
      }

      if (!settings.consentGiven) {
        this.logger.log('ASUP consent not given, skipping transmission');
        return;
      }

      this.logger.log('ASUP is enabled, starting metrics transmission...');
      await this.transmitAsupMetrics();
      
    } catch (error) {
      this.logger.error(`Weekly ASUP transmission failed: ${error.message}`);
    }
  }

  /**
   * Transmit ASUP metrics to the configured endpoint
   * 
   * This method:
   * 1. Generates migration analysis (active + deleted jobs)
   * 2. Converts to XML format
   * 3. Sends to ASUP endpoint (when configured)
   * 4. Updates last transmission timestamp in database
   * 
   * NOTE: Actual transmission is DISABLED for local testing.
   */
  async transmitAsupMetrics(): Promise<{ success: boolean; message: string; xml?: string }> {
    this.logger.log('Starting ASUP metrics generation...');

    try {
      // Generate the migration analysis (includes deleted jobs)
      const analysis = await this.asupService.generateMigrationAnalysis();
      
      if (!analysis.projects || analysis.projects.length === 0) {
        this.logger.log('No projects found, skipping transmission');
        return { success: false, message: 'No projects found to transmit' };
      }

      // Generate the XML
      const xml = this.asupService.generateXml(analysis);
      this.logger.log(`Generated ASUP XML: ${xml.length} bytes, ${analysis.projects.length} projects`);

      // ============================================================
      // ASUP TRANSMISSION
      // ============================================================
      if (this.asupEndpointUrl) {
        // When ASUP endpoint is configured, send the XML
        this.logger.log(`Transmitting ASUP metrics to: ${this.asupEndpointUrl}`);
        
        try {
          const axios = require('axios');
          const response = await axios.post(this.asupEndpointUrl, xml, {
            headers: {
              'Content-Type': 'application/xml',
              'X-ASUP-Source': 'NDM',
              'X-ASUP-Version': analysis.schemaVersion || '1.0.0',
            },
            timeout: 30000, // 30 second timeout
          });
          
          this.logger.log(`ASUP transmission completed: HTTP ${response.status}`);
          
          // Update last transmission timestamp in database
          await this.asupSettingsService.updateLastTransmission();
          
          return { 
            success: true, 
            message: `Successfully transmitted ASUP metrics (${xml.length} bytes)`,
            xml 
          };
        } catch (transmitError) {
          this.logger.error(`ASUP transmission failed: ${transmitError.message}`);
          // Don't throw - we still generated the XML successfully
          return { 
            success: false, 
            message: `XML generated but transmission failed: ${transmitError.message}`,
            xml 
          };
        }
      } else {
        // Local testing mode - just log the XML
        this.logger.log('ASUP endpoint not configured - XML generated but not transmitted');
        this.logger.debug(`ASUP XML Content:\n${xml.substring(0, 500)}...`);
        
        // Still update last transmission for testing purposes
        await this.asupSettingsService.updateLastTransmission();
        
        return { 
          success: true, 
          message: `Generated ASUP XML (${xml.length} bytes). Transmission disabled - no endpoint configured.`,
          xml 
        };
      }
      
    } catch (error) {
      this.logger.error(`ASUP metrics generation error: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Manually trigger ASUP transmission (for testing/admin purposes)
   * This bypasses the weekly schedule and runs immediately
   */
  async triggerManualTransmission(): Promise<{ success: boolean; message: string; xml?: string }> {
    this.logger.log('Manual ASUP transmission triggered');
    
    // Check if ASUP is enabled
    const settings = await this.asupSettingsService.getSettings();
    
    if (!settings.enabled) {
      return { 
        success: false, 
        message: 'ASUP is disabled. Enable it first to transmit metrics.' 
      };
    }
    
    return this.transmitAsupMetrics();
  }

  /**
   * Get the current scheduler status
   */
  async getSchedulerStatus(): Promise<{
    enabled: boolean;
    consentGiven: boolean;
    endpointConfigured: boolean;
    endpointUrl: string | undefined;
    lastTransmission: string | null;
  }> {
    const settings = await this.asupSettingsService.getSettings();
    
    return {
      enabled: settings.enabled,
      consentGiven: settings.consentGiven,
      endpointConfigured: !!this.asupEndpointUrl,
      endpointUrl: this.asupEndpointUrl,
      lastTransmission: settings.lastTransmission,
    };
  }
}