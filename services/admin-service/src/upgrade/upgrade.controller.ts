import {
  Controller,
  Get,
  Post,
  Delete,
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
   * GET /api/v1/upgrade/multicast/:workflowId
   * Gets the status of a multicast workflow
   */
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('multicast/:workflowId')
  @ApiOperation({
    summary: 'Get multicast workflow status',
    description: 'Returns the current status and progress of a multicast workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'Workflow ID returned from POST /multicast',
    example: 'BinaryMulticast-abc123',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow status',
    type: MulticastStatusDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Workflow not found',
  })
  async getMulticastStatus(
    @Param('workflowId') workflowId: string,
  ): Promise<MulticastStatusDto> {
    return this.upgradeService.getMulticastStatus(workflowId);
  }

  /**
   * DELETE /api/v1/upgrade/multicast/:workflowId
   * Terminates a running multicast workflow
   */
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Delete('multicast/:workflowId')
  @ApiOperation({
    summary: 'Terminate multicast workflow',
    description: 'Stops a running multicast workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'Workflow ID to terminate',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow terminated',
  })
  @ApiResponse({
    status: 404,
    description: 'Workflow not found or not running',
  })
  async terminateMulticast(
    @Param('workflowId') workflowId: string,
  ): Promise<{ terminated: boolean }> {
    const terminated = await this.upgradeService.terminateMulticast(workflowId);
    return { terminated };
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
   * GET /api/v1/upgrade/bundle-info/:version
   * Gets information about available bundles for a version.
   */
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('bundle-info/:version')
  @ApiOperation({
    summary: 'Get bundle information for a version',
    description: 'Returns information about available upgrade bundles (linux tar.gz, windows zip) for a specific version',
  })
  @ApiParam({ name: 'version', description: 'Target version', example: '2026.02.10185052-nightly' })
  @ApiResponse({ status: 200, description: 'Bundle information' })
  async getBundleInfo(@Param('version') version: string) {
    return this.upgradeService.getBundleInfo(version);
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

  /**
   * GET /api/v1/upgrade/distribution-status
   * Gets the distribution status for all workers
   */
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('distribution-status')
  @ApiOperation({
    summary: 'Get upgrade distribution status',
    description: 'Returns which workers have received the upgrade bundle',
  })
  @ApiResponse({
    status: 200,
    description: 'Distribution status',
  })
  async getDistributionStatus() {
    return this.upgradeService.getDistributionStatus();
  }
}
