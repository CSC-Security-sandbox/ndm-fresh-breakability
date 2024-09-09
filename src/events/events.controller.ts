import { Body, Controller, Get, Logger, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { RabbtMqService } from './rabbitmq.service';
import { TestConnectionDTO } from './dto/testconnection.dto';
import { EventsService } from './events.service';
import { TestConnectionsDTO } from './dto/agentconnection.dto';
import { QueueEvent } from './events.type';
import { ResponsePageFilterDto, ResponsePageFilterResponseDto } from './dto/responcefilter.dto';
import { ApiBadRequestResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MountConnectionsDTO } from './dto/agentmounts.dto';

@ApiTags("SocketEvents")
@Controller('events')
export class EventsController {
    private logger: Logger =  new  Logger (EventsController.name)
    constructor(
        private rabbtMqService:RabbtMqService,
        private eventsService: EventsService
    ) {}

    @Post('/test')
    async sendMessage(@Body() testConnectionDTO: TestConnectionDTO) {
        this.logger.debug(testConnectionDTO)
        this.rabbtMqService.publishToExchange(testConnectionDTO as QueueEvent)
    }  

    @Post('/test_connection')
    @ApiOperation({ summary: 'Test Agent Connections ' })
    @ApiCreatedResponse({ description: 'Test Agent Connection Request Created Successfully.', type: String })
    async testAgentConnetions(@Body() testConnectionsDTO: TestConnectionsDTO) {
        return this.eventsService.testAgentConnetions(testConnectionsDTO)
    }

    @Get('/response')
    @ApiOperation({ summary: 'Get a Response list of Agents',  description: 'Returns a list of Response based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Response has been retrieved successfully.',  type: ResponsePageFilterResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    async getResponse(@Query(new ValidationPipe({ transform: false, whitelist: true }))  responsePageFilterDto: ResponsePageFilterDto) {
        return this.eventsService.findAllRespose(responsePageFilterDto)
    }

    @Post('/mounts')
    @ApiOperation({ summary: 'Test Agent mounts ' })
    @ApiCreatedResponse({ description: 'Test Agent mounts Request Created Successfully.', type: String })
    async mountsAgentConnetions(@Body() mountConnectionsDTO: MountConnectionsDTO) {
        return this.eventsService.mountAgentConnetions(mountConnectionsDTO)
    }

}
