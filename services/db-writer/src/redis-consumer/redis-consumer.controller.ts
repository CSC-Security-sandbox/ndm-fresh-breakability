import { Body, Controller, Get, Post, Query, Inject, Headers } from '@nestjs/common';
import { ApiBody, ApiExcludeController, ApiQuery, ApiResponse, ApiTags, ApiHeader } from '@nestjs/swagger';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { ConsumerDto } from './redis-consumer.dto';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerType } from '../enum/redis-consumer.enum';
@ApiTags('Redis Consumer') // Swagger tag for grouping APIs
@Controller('redis-consumer')
@ApiExcludeController() // Exclude this controller from Swagger documentation
export class RedisConsumerController {
    private readonly logger: LoggerService;

    constructor(
        private redisConsumerService: RedisConsumerService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.logger = loggerFactory.create(RedisConsumerController.name);
    }

    /**
     * Start a consumer for a specific job.
     * UnAuthenticated as this endpoint is called internally by the jobs service.
     * Marked as hidden from the Swagger documentation using @ApiExcludeController.
     */
    @Post('start')
    @ApiBody({ description: 'Consumer Details', type: ConsumerDto })
    @ApiHeader({ name: 'projectId', description: 'Project ID for the job', required: false })
    @ApiResponse({ status: 200, description: 'Consumer started successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid input data.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async start(@Body() consumerDto: ConsumerDto, @Headers('projectId') projectId?: string) {
        const { jobRunId } = consumerDto;

        // Log the received projectId
        if (projectId) {
            this.logger.log(`Received projectId: ${projectId} for jobRunId: ${jobRunId}`);
        } else {
            this.logger.log(`No projectId provided in headers for jobRunId: ${jobRunId}`);
        }

        // Fire-and-forget: start the consumer process but don't wait for completion
        (async () => {
            try {
                await this.redisConsumerService.saveJobConsumersToRedis(jobRunId, projectId);
            } catch (error) {
                this.logger.error(`Failed to start consumer for job ${jobRunId}:`, error);
            }
        })();

        return { success: true, message: 'Consumer started successfully.' };
    }


}