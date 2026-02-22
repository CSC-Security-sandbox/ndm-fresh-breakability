import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Req,
    Request,
    ParseUUIDPipe,
    BadRequestException,
  } from '@nestjs/common';
  import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiConsumes,
  } from '@nestjs/swagger';
  import { Request as ExpressRequest } from 'express';
  import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
  import { UpgradeService } from './upgrade.service';
  import { InitUploadDto, InitUploadResponseDto, UploadChunkResponseDto } from './dto/upgrade.dto';
  import { UserPermissionResponse } from '../auth/user-permission-response-type';
  
  @ApiTags('upgrade')
  @Controller('/api/v1/upgrade')
  export class UpgradeController {
    constructor(private readonly upgradeService: UpgradeService) {}
  
    // ═══════════════════════════════════════════════════════════════
    // GET LATEST STATUS - For UI state restoration after page refresh
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Get('latest-upload-status')
    @ApiOperation({ summary: 'Get the latest upload status for UI state restoration' })
    async getLatestStatus() {
      return this.upgradeService.getLatestUploadStatus();
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 1: Initialize Upload Session
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('init')
    @ApiOperation({ summary: 'Initialize a new upgrade bundle upload session' })
    @ApiResponse({ status: 201, type: InitUploadResponseDto })
    async initUpload(
      @Body() dto: InitUploadDto,
      @Request() userPermissions: UserPermissionResponse,
    ): Promise<InitUploadResponseDto> {
      const userId = userPermissions?.user?.id;
      return this.upgradeService.initUpload(dto, userId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 2: Upload a Single Chunk
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('chunk-upload/:uploadId')
    @ApiOperation({ summary: 'Upload a single chunk of the upgrade bundle' })
    @ApiConsumes('application/octet-stream')
    @ApiResponse({ status: 200, type: UploadChunkResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid chunk index header' })
    async uploadChunk(
      @Param('uploadId', ParseUUIDPipe) uploadId: string,
      @Req() req: ExpressRequest,
    ): Promise<UploadChunkResponseDto> {
      // Validate chunk index header
      const chunkIndexHeader = req.headers['x-chunk-index'];
      if (chunkIndexHeader === undefined || chunkIndexHeader === null || chunkIndexHeader === '') {
        throw new BadRequestException('Missing X-Chunk-Index header');
      }
      
      const chunkIndex = parseInt(chunkIndexHeader as string, 10);
      if (isNaN(chunkIndex) || chunkIndex < 0) {
        throw new BadRequestException(`Invalid X-Chunk-Index header: ${chunkIndexHeader}. Must be a non-negative integer.`);
      }
      
      return this.upgradeService.uploadChunk(uploadId, chunkIndex, req);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 3: Process Upload (Assemble Chunks, Validate, Organize)
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('process-upload/:uploadId')
    @ApiOperation({ summary: 'Process upload: assemble chunks, validate checksums, organize files' })
    async processUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.processUpload(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 5: Cancel Upload (Cleanup)
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('cancel-upload/:uploadId')
    @ApiOperation({ summary: 'Cancel upload and cleanup temporary files' })
    async cancelUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.cancelUpload(uploadId);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 6: Trigger Upgrade
    // Checks for running/scheduled jobs, stages DB, fires ansible
    // Returns 409 with job list if blocked, 200 if upgrade initiated
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('trigger-upgrade')
    @ApiOperation({
      summary: 'Trigger the upgrade process',
      description:
        'Checks for running/scheduled jobs, saves current CP version, ' +
        'and starts the ansible upgrade playbook on the host via nsenter.',
    })
    @ApiResponse({ status: 200, description: 'Upgrade initiated successfully' })
    @ApiResponse({ status: 409, description: 'Blocked by running or scheduled jobs' })
    async triggerUpgrade(
      @Body() body: { bundleId: string },
      @Request() userPermissions: UserPermissionResponse,
    ) {
      const userId = userPermissions?.user?.id;
      return this.upgradeService.triggerUpgrade(body.bundleId, userId);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 6b: Get Upgrade Status (for UI polling after restart)
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
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
    // ENDPOINT 7: Skip Upgrade
    // Called when user clicks Reset after successful upload
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('skip')
    @ApiOperation({ 
      summary: 'Skip the upgrade for a successfully uploaded bundle',
      description: 'Marks the upgrade as skipped when user chooses not to proceed with upgrade after successful upload.'
    })
    @ApiResponse({ status: 200, description: 'Upgrade skipped successfully' })
    async skipUpgrade(@Body() body: { bundleId: string }) {
      return this.upgradeService.skipUpgrade(body.bundleId);
    }
  
  }