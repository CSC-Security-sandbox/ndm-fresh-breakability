import { ClassSerializerInterceptor, Controller, Get, Param, SerializeOptions, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JobRunService } from './job-run.service';
import { JobRunDetailsResponseDto, serializeJobRunDetailsResponse } from './dto/job-rundetails.dto';

@ApiTags('job-run')
@Controller('job-run')
export class JobRunController {
    constructor(
        private readonly jobRunService: JobRunService
    ) {}

    @ApiOperation({ summary: 'Get job run Details by ID' })
    @ApiOkResponse({ description: 'Returns a job run by its ID.' , type:JobRunDetailsResponseDto})
    @ApiResponse({ status: 404, description: 'Job run not found.' })

    @SerializeOptions({ type: JobRunDetailsResponseDto })
    @Get(':id')
    async getJobStatsId(@Param('id') id: string)  {
        const response =  await this.jobRunService.getJobStatsId(id);
        return serializeJobRunDetailsResponse(response)
    }


}
