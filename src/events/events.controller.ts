import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { RabbtMqService } from './rabbitmq.service';
import { TestConnectionDTO } from './dto/testconnection.dto';

@Controller('events')
export class EventsController {
    private logger: Logger =  new  Logger (EventsController.name)
    constructor(private rabbtMqService:RabbtMqService) {}

    @Post('/test_connection')
    async sendMessage(@Body() testConnectionDTO: TestConnectionDTO) {
        this.logger.debug(testConnectionDTO)
        this.rabbtMqService.publishToExchange(testConnectionDTO)
    }  
}
