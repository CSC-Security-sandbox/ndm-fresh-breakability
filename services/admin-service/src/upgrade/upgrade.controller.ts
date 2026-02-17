import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Header,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, AuthWorker, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { Response } from 'express';
import { UpgradeService } from './upgrade.service';
import {
  MulticastRequestDto,
  MulticastResponseDto,
  MulticastStatusDto,
  WorkerAckDto,
} from './dto/multicast.dto';

@ApiTags('upgrade')
@Controller('/api/v1/upgrade')
export class UpgradeController {
  constructor(private readonly upgradeService: UpgradeService) {}

  /**
   * POST /api/v1/upgrade/multicast
   * Initiates binary distribution to workers which are online
   */
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


  /**
   * GET /api/v1/upgrade/worker/:version/:platform
   * Streams the upgrade bundle for a specific version and platform.
   * Bundle contains: binary + env + checksums (tar.gz for linux, zip for windows).
   * Workers call this endpoint to download their bundles.
   * Protected by worker authentication (client credentials).
   */
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


  /**
   * POST /api/v1/upgrade/worker/ack
   * Worker calls this after successful bundle download + verification.
   * Sets upgrade_bundle_staged = COMPLETED for the worker in DB.
   */
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

  // Get the workflow status and the list of workers inprogress, failed, completed
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('multicast/:workflowId')
  @ApiOperation({
    summary: 'Get the workflow status and the list of workers inprogress, failed, completed',
    description:
      'Get the workflow status and the list of workers inprogress, failed, completed',
  })
  @ApiParam({ name: 'workflowId', description: 'The workflow ID' })
  @ApiResponse({
    status: 200,
    description: 'Workflow status and list of workers',
    type: MulticastStatusDto,
  })
  async getWorkflowStatus(
    @Param('workflowId') workflowId: string,
  ): Promise<MulticastStatusDto> {
    return this.upgradeService.getWorkflowStatus(workflowId);
  }
}