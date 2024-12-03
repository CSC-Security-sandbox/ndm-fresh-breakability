import { Controller, Query, BadRequestException, Get } from '@nestjs/common';
import { ApiQuery, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';

@ApiTags('Get discovery inventory')
@Controller('inventory')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
  ) { }

  @Get('/')
  @ApiOperation({ summary: 'Discover file server' })
  @ApiQuery({
    name: 'fileServerId',
    type: String,
    required: true,
    description: 'ID of the file server to be discovered',
  })
  @ApiResponse({ status: 200, description: 'Discovery inventory completed successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing fileServerId' })
  async discoverFileServerDefault(@Query('fileServerId') fileServerId: string): Promise<any> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId query parameter is required');
    }
    return await this.discoveryService.getDiscoveryByFileServerId(fileServerId);
  }

  @Get('/with-path')
  @ApiOperation({ summary: 'Discover inventory of file server' })
  @ApiQuery({
    name: 'fileServerId',
    type: String,
    required: true,
    description: 'ID of the file server to be discovered',
  })
  @ApiQuery({
    name: 'parentPath',
    type: String,
    required: true,
    description: 'Path of the folder to be discovered',
  })
  @ApiResponse({ status: 200, description: 'Discovery completed successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request: Missing fileServerId' })
  async discoverFileServerWithPath(
    @Query('fileServerId') fileServerId: string,
    @Query('parentPath') parentPath: string,
  ): Promise<any> {
    if (!fileServerId) {
      throw new BadRequestException('fileServerId query parameter is required');
    }

    return await this.discoveryService.getDiscoveryByFileServerIdAndParentPath(fileServerId, parentPath);
  }

}

