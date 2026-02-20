import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    Body,
    Req,
    Res,
    Request,
    HttpStatus,
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
  import { Request as ExpressRequest, Response } from 'express';
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
    @Get('latest-status')
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
    @Post('chunk_upload/:uploadId')
    @ApiOperation({ summary: 'Upload a single chunk of the upgrade bundle' })
    @ApiConsumes('application/octet-stream')
    @ApiResponse({ status: 200, type: UploadChunkResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid chunk index header' })
    async uploadChunk(
      @Param('uploadId', ParseUUIDPipe) uploadId: string,
      @Req() req: ExpressRequest,
      @Res() res: Response,
    ): Promise<void> {
      // Validate chunk index header
      const chunkIndexHeader = req.headers['x-chunk-index'];
      if (chunkIndexHeader === undefined || chunkIndexHeader === null || chunkIndexHeader === '') {
        throw new BadRequestException('Missing X-Chunk-Index header');
      }
      
      const chunkIndex = parseInt(chunkIndexHeader as string, 10);
      if (isNaN(chunkIndex) || chunkIndex < 0) {
        throw new BadRequestException(`Invalid X-Chunk-Index header: ${chunkIndexHeader}. Must be a non-negative integer.`);
      }
      
      const result = await this.upgradeService.uploadChunk(uploadId, chunkIndex, req);
      res.status(HttpStatus.OK).json(result);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 3: Get Upload Status/Progress
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Get('status/:uploadId')
    @ApiOperation({ summary: 'Get the current status of an upload' })
    async getStatus(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.getStatus(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 4: Process Upload (Assemble Chunks, Validate, Organize)
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('process_upload/:uploadId')
    @ApiOperation({ summary: 'Process upload: assemble chunks, validate checksums, organize files' })
    async processUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.processUpload(uploadId);
    }
  
    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 5: Cancel Upload (Cleanup)
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Delete('cancel_upload/:uploadId')
    @ApiOperation({ summary: 'Cancel upload and cleanup temporary files' })
    async cancelUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
      return this.upgradeService.cancelUpload(uploadId);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENDPOINT 6: Trigger Upgrade
    // Uses bundleId (primary key) for faster, safer queries
    // ═══════════════════════════════════════════════════════════════
    @Auth(Permission.AgentDeployment)
    @ApiBearerAuth()
    @Post('trigger')
    @ApiOperation({ summary: 'Trigger the upgrade process' })
    async triggerUpgrade(
      @Body() body: { bundleId: string },
      @Request() userPermissions: UserPermissionResponse,
    ) {
      const userId = userPermissions?.user?.id;
      return this.upgradeService.triggerUpgrade(body.bundleId, userId);
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