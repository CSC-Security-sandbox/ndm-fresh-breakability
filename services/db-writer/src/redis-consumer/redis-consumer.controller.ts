import { Body, Controller, Get, Post, Query, Inject } from '@nestjs/common';
import { ApiBody, ApiExcludeController, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsumerDto } from './redis-consumer.dto';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerType } from '../enum/redis-consumer.enum';
import {
    LoggerFactory,
    LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags('Redis Consumer') // Swagger tag for grouping APIs
@Controller('redis-consumer')
@ApiExcludeController() // Exclude this controller from Swagger documentation
export class RedisConsumerController {
    private logger: LoggerService;
    constructor(private redisConsumerService: RedisConsumerService,  @Inject(LoggerFactory) loggerFactory: LoggerFactory) {
        this.logger = loggerFactory.create(RedisConsumerController.name);
    }

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
        // Fire-and-forget: start the consumer process but don't wait for completion
        (async () => {
            try {
                await this.redisConsumerService.saveJobConsumersToRedis(jobRunId);
            } catch (error) {
                this.logger.error(`Failed to start consumer for job ${jobRunId}:`, error);
            }
        })();
      
        return { success: true, message: 'Consumer started successfully.' };
    }


}