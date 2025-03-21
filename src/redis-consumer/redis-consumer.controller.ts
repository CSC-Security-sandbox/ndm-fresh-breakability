import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ConsumerDto } from './redis-consumer.dto';
import { RedisConsumerService } from './redis-consumer.service';
import { ConsumerType } from 'src/enum/redis-consumer.enum';

@ApiTags('Redis Consumer') // Swagger tag for grouping APIs
@Controller('redis-consumer')
export class RedisConsumerController {
    constructor(private redisConsumerService: RedisConsumerService) {}

    /**
     * Start a consumer for a specific job.
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
     */
    @Get('active-consumers')
    @ApiResponse({ status: 200, description: 'List of active consumers retrieved successfully.' })
    @ApiResponse({ status: 500, description: 'Internal server error.' })
    async listActiveConsumers() {
        const activeConsumers = await this.redisConsumerService.listActiveConsumers();
        return { success: true, data: activeConsumers };
    }

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