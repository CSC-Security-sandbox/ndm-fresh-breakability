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
} from './dto/multicast.dto';

@ApiTags('upgrade')
@Controller('/api/v1/upgrade')
export class UpgradeController {
  constructor(private readonly upgradeService: UpgradeService) {}

  /**
   * POST /api/v1/upgrade/multicast
   * Initiates binary distribution to specified workers
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
   * GET /api/v1/upgrade/worker/:platform
   * Streams the binary file for a specific platform
   * Workers call this endpoint to download their binaries
   * Protected by worker authentication (client credentials)
   */
  @AuthWorker()
  @ApiBearerAuth()
  @Get('worker/:platform')
  @ApiOperation({
    summary: 'Download worker binary',
    description:
      'Streams the worker binary file for the specified platform (linux or windows). Requires worker authentication.',
  })
  @ApiParam({
    name: 'platform',
    description: 'Target platform',
    enum: ['linux', 'windows'],
  })
  @ApiProduces('application/octet-stream')
  @ApiResponse({
    status: 200,
    description: 'Binary file stream',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing worker token',
  })
  @ApiResponse({
    status: 404,
    description: 'Binary not found for platform',
  })
  @Header('Cache-Control', 'no-cache')
  async downloadBinary(
    @Param('platform') platform: 'linux' | 'windows',
    @Res() res: Response,
  ): Promise<void> {
    const streamableFile = await this.upgradeService.streamBinary(platform);
    
    // Set headers for binary download
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': streamableFile.getHeaders().disposition,
      'Content-Length': streamableFile.getHeaders().length,
      'Cache-Control': 'no-cache',
    });
    
    // Pipe the stream directly to response (bypasses ResponseInterceptor)
    streamableFile.getStream().pipe(res);
  }

  /**
   * GET /api/v1/upgrade/binary-info
   * Gets information about available binaries
   */
  @Auth(Permission.AgentDeployment)
  @ApiBearerAuth()
  @Get('binary-info')
  @ApiOperation({
    summary: 'Get binary information',
    description: 'Returns information about available worker binaries',
  })
  @ApiResponse({
    status: 200,
    description: 'Binary information',
  })
  async getBinaryInfo(): Promise<{
    linux: { available: boolean; filename?: string; size?: number };
    windows: { available: boolean; filename?: string; size?: number };
  }> {
    return this.upgradeService.getBinaryInfo();
  }
}
