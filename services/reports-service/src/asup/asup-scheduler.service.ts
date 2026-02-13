import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AsupService } from './asup.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

/**
 * AsupSchedulerService handles the weekly automated transmission of ASUP metrics.
 * 
 * Features:
 * - Weekly cron job (runs every Sunday at midnight)
 * - Respects user enable/disable settings
 * - Generates XML and transmits to ASUP endpoint
 * - Logs transmission status
 * 
 * NOTE: ASUP transmission is currently DISABLED for local testing.
 * The scheduler will generate XML but not send it anywhere.
 * When ASUP endpoint is ready, uncomment the transmission code.
 */
@Injectable()
export class AsupSchedulerService {
  private readonly logger: LoggerService;
  
  // In-memory settings reference (in production, use a proper settings service)
  private asupEnabled = false;
  private asupConsentGiven = false;

  constructor(
    private readonly asupService: AsupService,
    @Optional() @Inject(LoggerFactory) loggerFactory?: LoggerFactory
  ) {
    if (loggerFactory) {
      this.logger = loggerFactory.create(AsupSchedulerService.name);
    } else {
      this.logger = new Logger(AsupSchedulerService.name) as any;
    }
    this.logger.log('ASUP Scheduler Service initialized');
  }

  /**
   * Weekly cron job to transmit ASUP metrics
   * Runs every Sunday at midnight (00:00)
   * 
   * NOTE: Transmission is disabled for local testing
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyAsupTransmission() {
    this.logger.log('Weekly ASUP transmission job triggered');
    
    // Check if ASUP is enabled
    if (!this.asupEnabled) {
      this.logger.log('ASUP is disabled, skipping transmission');
      return;
    }

    if (!this.asupConsentGiven) {
      this.logger.log('ASUP consent not given, skipping transmission');
      return;
    }

    try {
      await this.transmitAsupMetrics();
    } catch (error) {
      this.logger.error(`Weekly ASUP transmission failed: ${error.message}`);
    }
  }

  /**
   * Transmit ASUP metrics to the configured endpoint
   * 
   * NOTE: Actual transmission is DISABLED for local testing.
   * The method generates XML and logs it, but does not send it anywhere.
   */
  async transmitAsupMetrics(): Promise<{ success: boolean; message: string; xml?: string }> {
    this.logger.log('Starting ASUP metrics generation (transmission disabled for local testing)');

    try {
      // Generate the migration analysis
      const analysis = await this.asupService.generateMigrationAnalysis();
      
      if (!analysis.projects || analysis.projects.length === 0) {
        this.logger.log('No projects found, skipping transmission');
        return { success: false, message: 'No projects found to transmit' };
      }

      // Generate the XML
      const xml = this.asupService.generateXml(analysis);
      this.logger.log(`Generated ASUP XML: ${xml.length} bytes, ${analysis.projects.length} projects`);

      // ============================================================
      // NOTE: ASUP TRANSMISSION IS DISABLED FOR LOCAL TESTING
      // ============================================================
      // When the ASUP endpoint is ready, uncomment the code below:
      //
      // const asupEndpointUrl = process.env.ASUP_ENDPOINT_URL;
      // if (asupEndpointUrl) {
      //   const response = await axios.post(asupEndpointUrl, xml, {
      //     headers: {
      //       'Content-Type': 'application/xml',
      //       'X-ASUP-Source': 'NDM',
      //       'X-ASUP-Version': analysis.schemaVersion,
      //     },
      //     timeout: 30000,
      //   });
      //   this.logger.log(`ASUP transmission completed: ${response.status}`);
      // }
      // ============================================================

      // For local testing, just log the XML and return it
      this.logger.log('ASUP XML generated successfully (transmission disabled)');
      this.logger.debug(`ASUP XML Content:\n${xml}`);
      
      return { 
        success: true, 
        message: `Successfully generated ASUP XML (${xml.length} bytes). Transmission disabled for local testing.`,
        xml 
      };
    } catch (error) {
      this.logger.error(`ASUP metrics generation error: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Update the ASUP settings (called by the controller when settings change)
   */
  updateSettings(enabled: boolean, consentGiven: boolean) {
    this.asupEnabled = enabled;
    this.asupConsentGiven = consentGiven;
    this.logger.log(`ASUP scheduler settings updated: enabled=${enabled}, consent=${consentGiven}`);
  }

  /**
   * Get current settings
   */
  getSettings(): { enabled: boolean; consentGiven: boolean } {
    return {
      enabled: this.asupEnabled,
      consentGiven: this.asupConsentGiven,
    };
  }
}