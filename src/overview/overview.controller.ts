import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { log } from 'console';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('overview')
export class OverviewController {
    constructor(private readonly overviewService: OverviewService) {}

@ApiTags('overview')
@ApiOperation({ summary: 'Get Storage and Jobs Overview' })
@ApiResponse({ status: 200, description: 'Returns the storage and job overview details.' })
@ApiResponse({ status: 404, description: 'Required parameters are missing in the request.' })
@ApiResponse({ status: 500, description: 'Internal server error.' })
@ApiParam({ name: 'projectId', description: 'Project Id' })
@ApiParam({ name: 'fileServerId', description: 'File Server Id' })
@ApiParam({ name: 'jobConfigId', description: 'Job Config Id' })  
@Get()
async getStorageAndJobsOverview(
    @Query('projectId') projectId: string,
    @Query('fileServerId') fileServerId: string,
    @Query('jobConfigId') jobConfigId: string,
) {
    if(!projectId && !fileServerId && !jobConfigId) {
        throw new NotFoundException(`Required parameters['ProjectId or FileServerId or JobConfig Id ' are missing in the request`);  
    }
    return await this.overviewService.getStorageAndJobsOverview(projectId, fileServerId, jobConfigId);   
}
}
