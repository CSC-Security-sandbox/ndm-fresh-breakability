import { Body, Controller, Get, Logger, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkerRequestDTO, WorkerResponseDto } from '../dto/responsefilter.dto';
import { EventsService } from '../service/events.service';
import { ValidateConnectionDto } from '../dto/validateconnection.dto';



@ApiTags("SocketEvents")
@Controller('workers')
export class EventsController {
    private logger: Logger =  new  Logger (EventsController.name)
    constructor(
        private eventsService: EventsService
    ) {}

    @Post('/event/validate-connection')
    @ApiOperation({ summary: 'Test Worker Connections ' })
    @ApiCreatedResponse({ description: 'Test Worker Connection Request Created Successfully.', type: String })
    async testWorkerConnections(@Body() validateConnectionDto: ValidateConnectionDto) {
        return this.eventsService.validateWorkerConnection(validateConnectionDto);
    }

    @Get('/response')
    @ApiOperation({ summary: 'Get a Response list of Workers',  description: 'Returns a list of Response based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Response has been retrieved successfully.',  type: WorkerResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    async getWorkerResponse(@Query(new ValidationPipe({ transform: true, whitelist: true }))  responsePageFilterDto: WorkerRequestDTO) {
        return this.eventsService.processWorkerResponses(responsePageFilterDto)
    }


    @Get('/event/refetch-paths/:configId')
    @ApiOperation({ summary: 'Refetch Config paths' })
    @ApiCreatedResponse({ description: 'Test Worker mounts Request Created Successfully.', type: String })
    async refetchExportPath(@Param('configId') configId: string) {
        return this.eventsService.fetchPaths(configId)
    }


}



