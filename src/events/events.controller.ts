import { Body, Controller, Get, Logger, Param, Post, Query, ValidationPipe } from '@nestjs/common';
import { RabbtMqService } from './rabbitmq.service';
import { TestConnectionDTO } from './dto/testconnection.dto';
import { EventsService } from './events.service';
import { TestConnectionsDTO } from './dto/agentconnection.dto';
import { QueueEvent } from './events.type';
import { ResponsePageFilterDto } from './dto/responcefilter.dto';

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
    async testAgentConnetions(@Body() testConnectionsDTO: TestConnectionsDTO) {
        return this.eventsService.testAgentConnetions(testConnectionsDTO)
    }

    @Get('/response')
    async getResponse(@Query(new ValidationPipe({ transform: false, whitelist: true }))  responsePageFilterDto: ResponsePageFilterDto) {
        return this.eventsService.findAllRespose(responsePageFilterDto)
    }

}
