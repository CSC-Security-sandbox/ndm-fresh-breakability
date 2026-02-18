import { Controller, Get, Put, Post, Param, Body, Res, Header, Inject, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth, ApiBody, ApiProperty } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { AsupService } from './asup.service';
import { AsupSettingsService } from './asup-settings.service';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';
import { IsBoolean, IsOptional } from 'class-validator';

// DTO for ASUP settings
export class AsupSettingsDto {
  @ApiProperty({ description: 'Whether ASUP is enabled' })
  enabled: boolean;
  
  @ApiProperty({ description: 'Whether user has given consent' })
  consentGiven: boolean;
  
  @ApiProperty({ description: 'Last time settings were updated', required: false })
  lastUpdated?: string;
  
  @ApiProperty({ description: 'Last time ASUP was transmitted', required: false })
  lastTransmission?: string;
}

export class UpdateAsupSettingsDto {
  @ApiProperty({ description: 'Whether ASUP is enabled', required: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
  
  @ApiProperty({ description: 'Whether user has given consent', required: false })
  @IsBoolean()
  @IsOptional()
  consentGiven?: boolean;
}

@ApiTags('asup')
@Controller('asup')
export class AsupController {
  private readonly logger: LoggerService;

  constructor(
    private readonly asupService: AsupService,
    private readonly asupSettingsService: AsupSettingsService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory
  ) {
    this.logger = loggerFactory.create(AsupController.name);
  }

  // ==================== ASUP Settings Endpoints ====================

  @ApiOperation({ summary: 'Get ASUP settings' })
  @ApiResponse({ status: 200, description: 'Returns current ASUP settings' })
  @Get('settings')
  async getAsupSettings(): Promise<AsupSettingsDto> {
    this.logger.log('Fetching ASUP settings from database');
    const settings = await this.asupSettingsService.getSettings();
    return {
      enabled: settings.enabled,
      consentGiven: settings.consentGiven,
      lastUpdated: settings.lastUpdated,
      lastTransmission: settings.lastTransmission,
    };
  }

  @ApiOperation({ summary: 'Update ASUP settings' })
  @ApiResponse({ status: 200, description: 'Returns updated ASUP settings with XML preview if consent given' })
  @ApiBody({ type: UpdateAsupSettingsDto })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Put('settings')
  async updateAsupSettings(
    @Body() updateDto: UpdateAsupSettingsDto,
    @Req() req: Request
  ): Promise<AsupSettingsDto & { xmlPreview?: string }> {
    this.logger.log(`Updating ASUP settings with body: ${JSON.stringify(updateDto)}`);
    
    // Get user ID from request (set by auth middleware)
    const userId = (req as any).user?.id || null;
    
    // Update settings in database
    const enabled = updateDto.enabled === true;
    const updatedSettings = await this.asupSettingsService.updateSettings(enabled, userId);
    
    this.logger.log(`ASUP settings updated: enabled=${updatedSettings.enabled}`);
    
    // If user just enabled ASUP and gave consent, generate and return the XML preview
    // This is for local testing - in production, this would be sent to ASUP endpoint
    let xmlPreview: string | undefined;
    if (updatedSettings.enabled) {
      try {
        const analysis = await this.asupService.generateMigrationAnalysis();
        xmlPreview = this.asupService.generateXml(analysis);
        this.logger.log(`Generated XML preview: ${xmlPreview.length} bytes`);
        
        // NOTE: ASUP transmission is disabled for local testing
        // TODO: Uncomment and configure when ASUP endpoint is available
        // const asupEndpointUrl = process.env.ASUP_ENDPOINT_URL;
        // if (asupEndpointUrl) {
        //   await this.httpService.post(asupEndpointUrl, xmlPreview, {
        //     headers: { 'Content-Type': 'application/xml' }
        //   }).toPromise();
        //   await this.asupSettingsService.updateLastTransmission();
        // }
      } catch (error) {
        this.logger.error(`Failed to generate XML preview: ${error.message}`);
        // Generate a minimal fallback XML on error
        xmlPreview = this.generateFallbackXml();
        this.logger.log('Generated fallback XML due to error');
      }
    }
    
    return {
      enabled: updatedSettings.enabled,
      consentGiven: updatedSettings.consentGiven,
      lastUpdated: updatedSettings.lastUpdated,
      lastTransmission: updatedSettings.lastTransmission,
      xmlPreview,
    };
  }
  
  /**
   * Generate a minimal fallback XML when the main generation fails
   */
  private generateFallbackXml(): string {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<MigrationAnalysis>
  <GeneratedAt>${now}</GeneratedAt>
  <SchemaVersion>1.0.0</SchemaVersion>
  <Status>ConsentGiven</Status>
  <Message>ASUP metrics collection enabled. Data will be collected in subsequent transmissions.</Message>
  <Projects/>
</MigrationAnalysis>`;
  }

  // ==================== Migration Analysis Endpoints ====================

  @ApiOperation({ summary: 'Get migration analysis metrics in JSON format' })
  @ApiResponse({ status: 200, description: 'Returns migration analysis data for all projects' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get('migration-analysis')
  async getMigrationAnalysis() {
    this.logger.log('Fetching migration analysis metrics');
    return this.asupService.generateMigrationAnalysis();
  }

  @ApiOperation({ summary: 'Get migration analysis metrics for a specific project' })
  @ApiResponse({ status: 200, description: 'Returns migration analysis data for a project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get('migration-analysis/project/:projectId')
  async getProjectMigrationAnalysis(@Param('projectId') projectId: string) {
    this.logger.log(`Fetching migration analysis for project: ${projectId}`);
    return this.asupService.generateProjectMigrationAnalysis(projectId);
  }

  @ApiOperation({ summary: 'Download migration analysis as XML file' })
  @ApiResponse({ status: 200, description: 'Returns migration analysis XML file' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get('migration-analysis/xml')
  async downloadMigrationAnalysisXml(@Res() res: Response) {
    this.logger.log('Generating migration analysis XML');
    
    const analysis = await this.asupService.generateMigrationAnalysis();
    const xml = this.asupService.generateXml(analysis);
    
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="migration-analysis-${new Date().toISOString().split('T')[0]}.xml"`);
    res.send(xml);
  }

  @ApiOperation({ summary: 'Get migration analysis XML as string (for preview)' })
  @ApiResponse({ status: 200, description: 'Returns migration analysis as XML string' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Get('migration-analysis/xml/preview')
  @Header('Content-Type', 'application/xml')
  async previewMigrationAnalysisXml() {
    this.logger.log('Previewing migration analysis XML');
    
    const analysis = await this.asupService.generateMigrationAnalysis();
    return this.asupService.generateXml(analysis);
  }

  // ==================== ASUP Transmission Endpoint ====================

  @ApiOperation({ summary: 'Manually trigger ASUP transmission (for testing/admin)' })
  @ApiResponse({ status: 200, description: 'Returns transmission status with XML preview' })
  @ApiBearerAuth()
  @Auth(Permission.Reports)
  @Post('transmit')
  async triggerAsupTransmission(): Promise<{ success: boolean; message: string; xml?: string }> {
    this.logger.log('Manually triggering ASUP transmission');
    
    // Get current settings from database
    const currentSettings = await this.asupSettingsService.getSettings();
    
    if (!currentSettings.enabled) {
      return { success: false, message: 'ASUP is disabled. Enable it first to transmit metrics.' };
    }
    
    try {
      // Generate the XML
      const analysis = await this.asupService.generateMigrationAnalysis();
      const xml = this.asupService.generateXml(analysis);
      
      this.logger.log(`ASUP XML generated: ${xml.length} bytes`);
      
      // Update last transmission timestamp
      await this.asupSettingsService.updateLastTransmission();
      
      // ============================================================
      // NOTE: ASUP TRANSMISSION IS DISABLED FOR LOCAL TESTING
      // ============================================================
      // When the ASUP endpoint is ready, uncomment the code below:
      //
      // const asupEndpointUrl = process.env.ASUP_ENDPOINT_URL;
      // if (asupEndpointUrl) {
      //   await this.httpService.post(asupEndpointUrl, xml, {
      //     headers: { 'Content-Type': 'application/xml' }
      //   }).toPromise();
      // }
      // ============================================================
      
      return { 
        success: true, 
        message: `ASUP metrics generated successfully (${xml.length} bytes). Transmission disabled for local testing.`,
        xml
      };
    } catch (error) {
      this.logger.error(`Failed to transmit ASUP metrics: ${error.message}`);
      return { success: false, message: `Failed to generate ASUP metrics: ${error.message}` };
    }
  }
}
