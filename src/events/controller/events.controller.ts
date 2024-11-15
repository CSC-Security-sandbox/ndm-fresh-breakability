import { Body, Controller, Get, Logger, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EventsService } from '../service/events.service';
import { TestConnectionsDTO } from '../dto/workerconnection.dto';
import { WorkerRequestDTO, WorkerResponseDto } from '../dto/responsefilter.dto';
import { MountConnectionsDTO } from '../dto/workermounts.dto';



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
    async testWorkerConnections(@Body() testConnectionsDTO: TestConnectionsDTO) {
        return this.eventsService.testWorkerConnections(testConnectionsDTO)
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

    @Post('/event/mounts')
    @ApiOperation({ summary: 'Test Worker mounts ' })
    @ApiCreatedResponse({ description: 'Test Worker mounts Request Created Successfully.', type: String })
    async fetchExportPath(@Body() mountConnectionsDTO: MountConnectionsDTO) {
        return this.eventsService.mountWorkerConnections(mountConnectionsDTO)
    }

    @Get('/event/refetch-paths/:configId')
    @ApiOperation({ summary: 'Refetch Config paths' })
    @ApiCreatedResponse({ description: 'Test Worker mounts Request Created Successfully.', type: String })
    async refetchExportPath(@Param('configId') configId: string) {
        this.eventsService.fetchPaths(configId)
    }


}



