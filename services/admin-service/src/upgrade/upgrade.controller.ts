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
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiProduces,
} from '@nestjs/swagger';
import { Request as ExpressRequest, Response } from 'express';
import { Auth, AuthWorker, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UpgradeService } from './upgrade.service';
import { InitUploadDto, InitUploadResponseDto, UploadChunkResponseDto } from './dto/upgrade.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
  ExecuteUpgradeRequestDto,
  ExecuteUpgradeResponseDto,
  ExecutionStatusDto,
  ExecutionAckDto,
} from './dto/multicast.dto';

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
  
  // POST /api/v1/upgrade/multicast
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Post('multicast')
  @ApiOperation({
    summary: 'Start binary multicast to workers',
    description:
      'Initiates a Temporal workflow to distribute worker binaries to specified workers',
  })
  @ApiBody({ type: MulticastRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Multicast workflow started',
    type: MulticastResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to start workflow',
  })
  async startMulticast(
    @Body() dto: MulticastRequestDto,
  ): Promise<MulticastResponseDto> {
    return this.upgradeService.startMulticast(dto);
  }


  //GET /api/v1/upgrade/worker/:version/:platform
  @AuthWorker()
  @ApiBearerAuth()
  @Get('worker/:version/:platform')
  @ApiOperation({
    summary: 'Download worker upgrade bundle',
    description:
      'Streams the upgrade bundle for the specified version and platform. ' +
      'Linux: tar.gz, Windows: zip. Each bundle contains binary + env + checksums. ' +
      'Requires worker authentication.',
  })
  @ApiParam({ name: 'version', description: 'Target version', example: '2026.02.10185052-nightly' })
  @ApiParam({ name: 'platform', description: 'Target platform', enum: ['linux', 'windows'] })
  @ApiProduces('application/octet-stream')
  @ApiResponse({ status: 200, description: 'Bundle file stream' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Bundle not found for version/platform' })
  @Header('Cache-Control', 'no-cache')
  async downloadBundle(
    @Param('version') version: string,
    @Param('platform') platform: 'linux' | 'windows',
    @Res() res: Response,
  ): Promise<void> {
    const streamableFile = await this.upgradeService.streamBundle(version, platform);
    
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': streamableFile.getHeaders().disposition,
      'Content-Length': streamableFile.getHeaders().length,
      'Cache-Control': 'no-cache',
    });
    
    streamableFile.getStream().pipe(res);
  }

  // POST /api/v1/upgrade/worker/ack
  @AuthWorker()
  @ApiBearerAuth()
  @Post('worker/ack')
  @ApiOperation({
    summary: 'Acknowledge binary download',
    description:
      'Worker calls this after successful download and checksum verification. Updates upgrade_bundle_staged flag.',
  })
  @ApiBody({ type: WorkerAckDto })
  @ApiResponse({
    status: 201,
    description: 'Acknowledged',
  })
  async acknowledgeDownload(
    @Body() dto: WorkerAckDto,
  ): Promise<{ acknowledged: boolean }> {
    return this.upgradeService.acknowledgeWorkerDownload(dto);
  }

  // Get multicast status by version — looks up workflowId from upgrade_bundles
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('multicast/:bundleId/:version')
  @ApiOperation({
    summary: 'Get multicast workflow status',
    description:
      'Looks up the multicast workflow ID from the upgrade bundle and returns per-worker distribution status.',
  })
  @ApiParam({ name: 'bundleId', description: 'Upgrade bundle ID' })
  @ApiParam({ name: 'version', description: 'Target upgrade version', example: '2026.02.10185052-nightly' })
  @ApiResponse({
    status: 200,
    description: 'Workflow status and list of workers',
    type: MulticastStatusDto,
  })
  async getMulticastStatus(
    @Param('bundleId') bundleId: string,
    @Param('version') version: string,
  ): Promise<MulticastStatusDto> {
    return this.upgradeService.getMulticastStatus(bundleId, version);
  }

  // POST /api/v1/upgrade/execute
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Post('execute')
  @ApiOperation({
    summary: 'Trigger upgrade execution on staged workers',
    description:
      'Starts a Temporal workflow to execute upgrade.sh/ps1 on all workers that have completed binary staging.',
  })
  @ApiBody({ type: ExecuteUpgradeRequestDto })
  @ApiResponse({ status: 201, description: 'Upgrade execution started', type: ExecuteUpgradeResponseDto })
  @ApiResponse({ status: 400, description: 'No staged workers found' })
  async startExecution(
    @Body() dto: ExecuteUpgradeRequestDto,
  ): Promise<ExecuteUpgradeResponseDto> {
    return this.upgradeService.startExecution(dto);
  }

  //GET /api/v1/upgrade/execute/:workflowId
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('execute/:bundleId/:version')
  @ApiOperation({
    summary: 'Get upgrade execution status',
    description:
      'Looks up execution workflow ID from upgrade bundle and returns per-worker execution status.',
  })
  @ApiParam({ name: 'bundleId', description: 'Upgrade bundle ID' })
  @ApiParam({ name: 'version', description: 'Target upgrade version', example: '2026.02.10185052-nightly' })
  @ApiResponse({ status: 200, description: 'Execution status', type: ExecutionStatusDto })
  async getExecutionStatus(
    @Param('bundleId') bundleId: string,
    @Param('version') version: string,
  ): Promise<ExecutionStatusDto> {
    return this.upgradeService.getExecutionStatus(bundleId, version);
  }

  //POST /api/v1/upgrade/worker/execution-ack
  @AuthWorker()
  @ApiBearerAuth()
  @Post('worker/execution-ack')
  @ApiOperation({
    summary: 'Acknowledge upgrade execution',
    description: 'Worker sends this after rebooting with the new version. Updates execution status to COMPLETED.',
  })
  @ApiBody({ type: ExecutionAckDto })
  @ApiResponse({ status: 201, description: 'Acknowledged' })
  async acknowledgeExecution(
    @Body() dto: ExecutionAckDto,
  ): Promise<{ acknowledged: boolean }> {
    return this.upgradeService.acknowledgeExecution(dto);
  }
}
