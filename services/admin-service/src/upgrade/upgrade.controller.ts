import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Req,
  Res,
  Request,
  Header,
  Inject,
  ParseUUIDPipe,
  BadRequestException,
  HttpCode,
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
import { Auth, Permission, AuthWorker } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { UpgradeService } from './upgrade.service';
import {
  InitUploadDto,
  InitUploadResponseDto,
  UploadChunkResponseDto,
  SaveStoppedJobIdsDto,
} from './dto/upgrade.dto';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
  ExecuteUpgradeRequestDto,
  ExecuteUpgradeResponseDto,
  ExecutionAckDto,
  ExecutionStatusDto,
} from './dto/multicast.dto';
import { UserPermissionResponse } from '../auth/user-permission-response-type';

@ApiTags('upgrade')
@Controller('/api/v1/upgrade')
export class UpgradeController {
  private readonly logger: LoggerService;

  constructor(
    private readonly upgradeService: UpgradeService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(UpgradeController.name);
  }

  // ═══════════════════════════════════════════════════════════════
  // GET LATEST STATUS - For UI state restoration after page refresh
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Get('latest-upload-status')
  @ApiOperation({ summary: 'Get the latest upload status for UI state restoration' })
  async getLatestStatus() {
    return this.upgradeService.getLatestUploadStatus();
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 1: Initialize Upload Session
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
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
  @Auth(Permission.UpgradeManagement)
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
  // Returns 202 immediately; heavy processing runs in the background.
  // Client polls GET /latest-upload-status to track completion.
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Post('process-upload/:uploadId')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start async processing: assemble chunks, validate checksums, organize files. Returns 202 immediately; poll /latest-upload-status for result.' })
  @ApiResponse({ status: 202, description: 'Processing started in background' })
  async processUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
    return this.upgradeService.processUpload(uploadId);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 5: Cancel Upload (Cleanup)
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Post('cancel-upload/:uploadId')
  @ApiOperation({ summary: 'Cancel upload and cleanup temporary files' })
  async cancelUpload(@Param('uploadId', ParseUUIDPipe) uploadId: string) {
    return this.upgradeService.cancelUpload(uploadId);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 6: Trigger Upgrade
  // Uses bundleId (primary key) for faster, safer queries
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Post('trigger-upgrade')
  @ApiOperation({ summary: 'Trigger the upgrade process' })
  async triggerUpgrade(
    @Body() body: { bundleId: string },
    @Request() userPermissions: UserPermissionResponse,
  ) {
    const userId = userPermissions?.user?.id;
    return this.upgradeService.triggerUpgrade(body.bundleId, userId);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 6b: Save Stopped Job IDs
  // Persists deactivated config IDs + stopped run IDs to the bundle
  // record so they survive CP restart and page reload.
  // Pass empty arrays to clear (after re-activation).
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Patch('bundle/:bundleId/stopped-job-ids')
  @ApiOperation({
    summary: 'Save or clear stopped job IDs for a bundle',
    description: 'Persists deactivated config IDs and stopped run IDs to the upgrade bundle so they survive CP restart. Pass empty arrays to clear after re-activation.',
  })
  @ApiResponse({ status: 200, description: 'Stopped job IDs saved' })
  async saveStoppedJobIds(
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
    @Body() body: SaveStoppedJobIdsDto,
  ) {
    return this.upgradeService.saveStoppedJobIds(
      bundleId,
      body.deactivatedConfigIds ?? [],
      body.stoppedRunIds ?? [],
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 7: Skip Upgrade
  // Called when user clicks Reset after successful upload
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
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

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 8: Start Binary Multicast to Workers
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
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

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 9: Download Worker Upgrade Bundle
  // ═══════════════════════════════════════════════════════════════
  @AuthWorker()
  @ApiBearerAuth()
  @Get('worker/download/:version/:platform')
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

    const stream = streamableFile.getStream();
    stream.on('error', (err) => {
      this.logger.error('Error streaming bundle file', err);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    stream.pipe(res);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 10: Worker Acknowledges Bundle Download
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 11: Get Multicast Workflow Status
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Get('multicast/:bundleId')
  @ApiOperation({
    summary: 'Get multicast workflow status',
    description:
      'Looks up the multicast workflow ID from the upgrade bundle and returns per-worker distribution status.',
  })
  @ApiParam({ name: 'bundleId', description: 'Upgrade bundle ID' })
  @ApiResponse({
    status: 200,
    description: 'Workflow status and list of workers',
    type: MulticastStatusDto,
  })
  @ApiResponse({ status: 404, description: 'No multicast workflow found for this bundle' })
  async getMulticastStatus(
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
  ): Promise<MulticastStatusDto> {
    return this.upgradeService.getMulticastStatus(bundleId);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 12: Start Upgrade Execution on Workers
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Post('execute')
  @ApiOperation({
    summary: 'Start upgrade execution on staged workers',
    description:
      'Triggers the upgrade script on all workers that have completed binary staging. ' +
      'Workers will stop, swap the binary, and restart.',
  })
  @ApiBody({ type: ExecuteUpgradeRequestDto })
  @ApiResponse({ status: 201, description: 'Execution workflow started', type: ExecuteUpgradeResponseDto })
  @ApiResponse({ status: 400, description: 'No staged workers or invalid request' })
  async startExecution(
    @Body() dto: ExecuteUpgradeRequestDto,
  ): Promise<ExecuteUpgradeResponseDto> {
    return this.upgradeService.startExecution(dto);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 13: Worker Acknowledges Upgrade Execution
  // ═══════════════════════════════════════════════════════════════
  @AuthWorker()
  @ApiBearerAuth()
  @Post('worker/execution-ack')
  @ApiOperation({
    summary: 'Worker acknowledges upgrade execution',
    description:
      'Worker calls this after rebooting with the new binary. ' +
      'Updates worker version and execution status in the database.',
  })
  @ApiBody({ type: ExecutionAckDto })
  @ApiResponse({ status: 201, description: 'Acknowledged' })
  async acknowledgeExecution(
    @Body() dto: ExecutionAckDto,
  ): Promise<{ acknowledged: boolean; message?: string }> {
    return this.upgradeService.acknowledgeExecution(dto);
  }

  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 14: Get Upgrade Execution Status
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
  @ApiBearerAuth()
  @Get('execute/:bundleId')
  @ApiOperation({
    summary: 'Get upgrade execution status',
    description:
      'Returns per-worker upgrade execution status. ' +
      'After 5-minute window, marks remaining in-progress workers as timed out.',
  })
  @ApiParam({ name: 'bundleId', description: 'Upgrade bundle ID' })
  @ApiResponse({ status: 200, description: 'Execution status', type: ExecutionStatusDto })
  async getExecutionStatus(
    @Param('bundleId', ParseUUIDPipe) bundleId: string,
  ): Promise<ExecutionStatusDto> {
    return this.upgradeService.getExecutionStatus(bundleId);
  }


  // ═══════════════════════════════════════════════════════════════
  // ENDPOINT 6b: Get Upgrade Status (for UI polling after restart)
  // ═══════════════════════════════════════════════════════════════
  @Auth(Permission.UpgradeManagement)
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
}
