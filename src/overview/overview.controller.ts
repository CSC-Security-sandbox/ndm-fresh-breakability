import { BadRequestException, Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { OverviewService } from './overview.service';
import { log } from 'console';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OverviewDTO } from './overview.dto';

@Controller('overview')
export class OverviewController {
  downloadReports(arg0: undefined[], arg1: string): any {
    throw new Error('Method not implemented.');
  }
    constructor(private readonly overviewService: OverviewService) {}

@ApiTags('overview')
@ApiOperation({ summary: 'Get Storage and Jobs Overview' })
@ApiResponse({ status: 200, description: 'Returns the storage and job overview details.' })
@ApiResponse({ status: 404, description: 'Required parameters are missing in the request.' })
@ApiResponse({ status: 500, description: 'Internal server error.' }) 
@ApiOkResponse({ description: 'Configuration Found' ,  type: OverviewDTO})
@ApiQuery({ name: 'projectId', required: false, type: String, description: 'Project Id'})
@ApiQuery({ name: 'fileServerId', required: false, type: String, description: 'File Server Id' })
@ApiQuery({ name: 'jobConfigId', required: false, type: String, description: 'Job Config Id' })
@Get()
async getStorageAndJobsOverview(
    @Query('projectId') projectId: string,
    @Query('fileServerId') configId: string,
    @Query('jobConfigId') jobConfigId: string,
) {
    if(!projectId && !configId && !jobConfigId) {
        throw new BadRequestException(`Required parameters['ProjectId or configId or JobConfig Id ' are missing in the request`);  
    }
    return await this.overviewService.getStorageAndJobsOverview(projectId, configId, jobConfigId);   
}
}
