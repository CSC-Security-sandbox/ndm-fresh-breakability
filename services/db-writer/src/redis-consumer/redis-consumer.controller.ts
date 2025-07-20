import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiExcludeController, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsumerDto } from './redis-consumer.dto';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerType } from '../enum/redis-consumer.enum';
@ApiTags('Redis Consumer') // Swagger tag for grouping APIs
@Controller('redis-consumer')
@ApiExcludeController() // Exclude this controller from Swagger documentation
export class RedisConsumerController {
    constructor(private redisConsumerService: RedisConsumerService) {}

    /**
     * Start a consumer for a specific job.
     * UnAuthenticated as this endpoint is called internally by the jobs service.
     * Marked as hidden from the Swagger documentation using @ApiExcludeController.
     */
    @Post('start')
    @ApiBody({ description: 'Consumer Details', type: ConsumerDto })
    @ApiResponse({ status: 200, description: 'Consumer started successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid input data.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async start(@Body() consumerDto: ConsumerDto) {
        const { jobRunId } = consumerDto;
        this.redisConsumerService.saveJobConsumersToRedis(jobRunId);
        return { success: true, message: 'Consumer started successfully.' };
    }


}