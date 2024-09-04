import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsStatusPageDto, AgentsStatusPageResponceDto } from './dto/agents.page.dto';
import { AgentsService } from './agents.service';


@ApiTags("Agents")
@Controller('agents')
export class AgentsController {

    constructor(private agentsService: AgentsService) {}

    @ApiOperation({ summary: 'Get a paginated list of Agents',  description: 'Returns a list of Agents based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Agents has been retrieved successfully.',  type: AgentsStatusPageResponceDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Get('/all')
    async getAgents(@Query(new ValidationPipe({ transform: false, whitelist: true }))  agentsStatusPageDto: AgentsStatusPageDto) {
        return await this.agentsService.findAllAgents(agentsStatusPageDto);
    }
}
