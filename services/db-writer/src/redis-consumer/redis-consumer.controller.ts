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
         this.redisConsumerService.startConsumer(jobRunId);
        return { success: true, message: 'Consumer started successfully.' };
    }

    /**
     * Stop a consumer for a specific job.
     * UnAuthenticated as this endpoint is called internally by the jobs service.
     * Marked as hidden from the Swagger documentation using @ApiExcludeController.
     */
    @Post('stop')
    @ApiQuery({ name: 'jobRunId', type: String, description: 'The ID of the job run.' })
    @ApiQuery({ name: 'consumerType', enum: ConsumerType, required: false, description: 'The type of consumer to stop.' })
    @ApiQuery({ name: 'all', type: Boolean, required: false, description: 'Stop all consumers for the job.' })
    @ApiResponse({ status: 200, description: 'Consumer stopped successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid input data.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async stop(
        @Query('jobRunId') jobRunId: string,
        @Query('consumerType') consumerType?: ConsumerType,
        @Query('all') all?: boolean,
    ) {
        await this.redisConsumerService.stopConsumer(jobRunId, consumerType, all === true);
        return { success: true, message: 'Consumer stopped successfully.' };
    }

    /**
     * List all active consumers.
     * UnAuthenticated as this endpoint is called internally by the jobs service.
     * Marked as hidden from the Swagger documentation using @ApiExcludeController.
     */
    @Get('active-consumers')
    @ApiResponse({ status: 200, description: 'List of active consumers retrieved successfully.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async listActiveConsumers() {
        const activeConsumers = await this.redisConsumerService.listActiveConsumers();
        return { success: true, data: activeConsumers };
    }

    /**
     * Check if a specific consumer is running.
     * UnAuthenticated as this endpoint is called internally by the jobs service.
     * Marked as hidden from the Swagger documentation using @ApiExcludeController.
     */
    @Get('is-running')
    @ApiQuery({ name: 'jobRunId', type: String, description: 'The ID of the job run.' })
    @ApiQuery({ name: 'consumerType', enum: ConsumerType, description: 'The type of consumer to check.' })
    @ApiResponse({ status: 200, description: 'Consumer status retrieved successfully.' })
    @ApiResponse({ status: 400, description: 'Invalid input data.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async isConsumerRunning(
        @Query('jobRunId') jobRunId: string,
        @Query('consumerType') consumerType: ConsumerType,
    ) {
        const isRunning = await this.redisConsumerService.isConsumerRunning(
            this.redisConsumerService.getConsumerKey(jobRunId, consumerType),
        );
        return { success: true, isRunning };
    }
}