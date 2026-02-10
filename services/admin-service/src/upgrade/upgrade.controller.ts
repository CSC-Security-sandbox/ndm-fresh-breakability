import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Header,
  StreamableFile,
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
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
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
   */
  @Get('worker/:platform')
  @ApiOperation({
    summary: 'Download worker binary',
    description:
      'Streams the worker binary file for the specified platform (linux or windows)',
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
    status: 404,
    description: 'Binary not found for platform',
  })
  @Header('Cache-Control', 'no-cache')
  async downloadBinary(
    @Param('platform') platform: 'linux' | 'windows',
  ): Promise<StreamableFile> {
    return this.upgradeService.streamBinary(platform);
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
