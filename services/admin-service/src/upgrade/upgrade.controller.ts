import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    Body,
    Query,
    Req,
    Res,
    HttpStatus,
    ParseUUIDPipe,
  } from '@nestjs/common';
  import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiConsumes,
    ApiQuery,
  } from '@nestjs/swagger';
  import { Request, Response } from 'express';
  import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
  import { UpgradeService } from './upgrade.service';
  import { InitUploadDto, InitUploadResponseDto } from './dto/init-upload.dto';
  import { UploadChunkResponseDto } from './dto/upload-chunk.dto';
  
  @ApiTags('upgrade')
  @Controller('/api/v1/upgrade')
  export class UpgradeController {
    constructor(private readonly upgradeService: UpgradeService) {}
  
    // ═══════════════════════════════════════════════════════════════
    // GET LATEST STATUS - For UI state restoration after page refresh
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Get('latest-status')
    @ApiOperation({ summary: 'Get the latest upload status for UI state restoration' })
    async getLatestStatus() {
      return this.upgradeService.getLatestUploadStatus();
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 1: Initialize Upload Session
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('init')
    @ApiOperation({ summary: 'Initialize a new upgrade bundle upload session' })
    @ApiResponse({ status: 201, type: InitUploadResponseDto })
    async initUpload(@Body() dto: InitUploadDto): Promise<InitUploadResponseDto> {
      return this.upgradeService.initUpload(dto);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 2: Upload a Single Chunk
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('chunk/:uploadId')
    @ApiOperation({ summary: 'Upload a single chunk of the upgrade bundle' })
    @ApiConsumes('application/octet-stream')
    @ApiResponse({ status: 200, type: UploadChunkResponseDto })
    async uploadChunk(
      @Param('uploadId', ParseUUIDPipe) uploadId: string,
      @Req() req: Request,
      @Res() res: Response,
    ): Promise<void> {
      const chunkIndex = parseInt(req.headers['x-chunk-index'] as string, 10);
      const result = await this.upgradeService.uploadChunk(uploadId, chunkIndex, req);
      res.status(HttpStatus.OK).json(result);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 3: Get Upload Status/Progress
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Get('status/:uploadId')
    @ApiOperation({ summary: 'Get the current status of an upload' })
    async getStatus(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.getStatus(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 4: Finalize Upload (Assemble Chunks)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('finalize/:uploadId')
    @ApiOperation({ summary: 'Finalize upload: assemble chunks' })
    async finalizeUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.finalizeUpload(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 5: Cancel Upload (Cleanup)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Delete('cancel/:uploadId')
    @ApiOperation({ summary: 'Cancel upload and cleanup temporary files' })
    async cancelUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.cancelUpload(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 6: Trigger Upgrade
    // Checks for running/scheduled jobs, stages DB, fires ansible
    // Returns 409 with job list if blocked, 200 if upgrade initiated
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('trigger')
    @ApiOperation({
      summary: 'Trigger the upgrade process',
      description:
        'Checks for running/scheduled jobs, saves current CP version, ' +
        'and starts the ansible upgrade playbook on the host via nsenter.',
    })
    @ApiResponse({ status: 200, description: 'Upgrade initiated successfully' })
    @ApiResponse({ status: 409, description: 'Blocked by running or scheduled jobs' })
    async triggerUpgrade(
      @Body() body: { filePath: string; fileName?: string },
    ) {
      return this.upgradeService.triggerUpgrade(body.filePath, body.fileName);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 6b: Get Upgrade Status (for UI polling after restart)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Get('upgrade-status')
    @ApiOperation({
      summary: 'Get the current upgrade status',
      description:
        'Returns upgrade outcome after pod restarts. ' +
        'Includes worker upgrade readiness when CP upgrade succeeds.',
    })
    async getUpgradeStatus() {
      return this.upgradeService.getUpgradeStatus();
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 7: Cleanup Directory
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Delete('cleanup')
    @ApiOperation({ summary: 'Cleanup upgrade bundle directory' })
    async cleanupDirectory() {
      return this.upgradeService.cleanupDirectory();
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 8: Get Upload History (Audit)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Get('history')
    @ApiOperation({ summary: 'Get upload history for audit' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getHistory(@Query('limit') limit?: number) {
      return this.upgradeService.getUploadHistory(limit || 10);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 9: Process Bundle (Manual validation & organization)
    // ═══════════════════════════════════════════════════════════════
    @Auth()
    @ApiBearerAuth()
    @Post('process/:bundleId')
    @ApiOperation({ 
      summary: 'Process an uploaded bundle: extract, validate checksums, organize for deployment' 
    })
    async processBundle(@Param('bundleId', ParseUUIDPipe) bundleId: string) {
      return this.upgradeService.processUploadedBundle(bundleId);
    }
  }