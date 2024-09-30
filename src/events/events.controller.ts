import { Body, Controller, Get, Logger, Post, Query, ValidationPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TestConnectionsDTO } from './dto/workerconnection.dto';
import { MountConnectionsDTO } from './dto/workermounts.dto';
import { ResponsePageFilterDto, ResponsePageFilterResponseDto } from './dto/responcefilter.dto';
import { EventsService } from './events.service';
import { RabbtMqService } from './rabbitmq.service';

@ApiTags("SocketEvents")
@Controller('events')
export class EventsController {
    private logger: Logger =  new  Logger (EventsController.name)
    constructor(
        private rabbtMqService: RabbtMqService,
        private eventsService: EventsService
    ) {}

    @Post('/test-connection')
    @ApiOperation({ summary: 'Test Worker Connections ' })
    @ApiCreatedResponse({ description: 'Test Worker Connection Request Created Successfully.', type: String })
    async testWorkerConnetions(@Body() testConnectionsDTO: TestConnectionsDTO) {
        return this.eventsService.testWorkerConnetions(testConnectionsDTO)
    }

    @Get('/response')
    @ApiOperation({ summary: 'Get a Response list of Workers',  description: 'Returns a list of Response based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Response has been retrieved successfully.',  type: ResponsePageFilterResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    async getResponse(@Query(new ValidationPipe({ transform: true, whitelist: true }))  responsePageFilterDto: ResponsePageFilterDto) {
        return this.eventsService.findAllResponse(responsePageFilterDto)
    }

    @Post('/mounts')
    @ApiOperation({ summary: 'Test Worker mounts ' })
    @ApiCreatedResponse({ description: 'Test Worker mounts Request Created Successfully.', type: String })
    async mountsWorkerConnetions(@Body() mountConnectionsDTO: MountConnectionsDTO) {
        return this.eventsService.mountWorkerConnetions(mountConnectionsDTO)
    }

    // @Post('/test')
    // async sendMessage(@Body() testConnectionDTO: TestConnectionDTO) {
    //     this.logger.debug(testConnectionDTO)
    //     this.rabbtMqService.publishToExchange(testConnectionDTO as QueueEvent)
    // }  

}
