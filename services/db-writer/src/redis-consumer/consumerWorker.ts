import { parentPort, workerData } from 'worker_threads';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { TaskEntity } from '../entities/task.entity';
import { OperationsEntity } from '../entities/operation.entity';
import { TaskErrorEntity } from '../entities/task-error.entity';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { RedisConsumerService } from './redis-consumer.service';
import { ConfigService } from '@nestjs/config';
import { DatabasePool } from './database-pool';

let dataSource: DataSource;
let inventoryService: InventoryService | null = null;
let workflowService: WorkflowService | null = null;
let redisConsumerService: RedisConsumerService | null = null;
const logger = new Logger('WorkerService');
const dbPool = DatabasePool.getInstance();

/**
 * Performs cleanup actions like releasing DB connections and running garbage collection.
 */
async function performCleanup() {
    logger.log('Starting worker cleanup');
    try {
        // Clean up RedisConsumerService
        if (redisConsumerService) {
            logger.log('Cleaning up RedisConsumerService');
            try {
                await redisConsumerService.cleanupResources();
            } catch (error) {
                logger.error('Error during RedisConsumerService cleanup:', error);
            }
            redisConsumerService = null;
        }

        // Clean up service references
        if (inventoryService) {
            inventoryService = null;
        }

        if (workflowService) {
            workflowService = null;
        }

        // Release database connection
        if (dataSource) {
            logger.log('Releasing database connection');
            await dbPool.releaseConnection();
            dataSource = null;
        }
        logger.log('Worker cleanup completed');
    } catch (error) {
        logger.error('Error during cleanup:', error);
    }
}

/**
 * Gracefully handles exit signals and performs cleanup.
 */
async function handleGracefulShutdown(signal: string) {
    logger.warn(`Received ${signal}, shutting down worker gracefully`);
    
    try {
        await performCleanup();
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception:', error);
    logger.error('Stack trace:', error.stack);
    
    try {
        await performCleanup();
    } catch (cleanupError) {
        logger.error('Error during exception cleanup:', cleanupError);
    }
    
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    
    try {
        await performCleanup();
    } catch (cleanupError) {
        logger.error('Error during rejection cleanup:', cleanupError);
    }
    
    process.exit(1);
});



/**
 * Main execution logic for the worker.
 */
(async function runConsumerWorker() {
    logger.log(`Worker thread starting for jobRunId=${workerData?.jobRunId}`);

    

    try {
        // Validate required input
        if (!workerData?.jobRunId) {
            throw new Error('Missing required parameter: jobRunId');
        }

        const jobRunId = workerData.jobRunId;
        logger.log(`Processing job: ${jobRunId}`);

        // Acquire database connection
        logger.log('Acquiring database connection');
        dataSource = await dbPool.getConnection();
        logger.log('Database connection acquired');

        // Initialize repositories
        logger.log('Initializing repositories');
        const inventoryRepo = dataSource.getRepository(InventoryEntity);
        const taskRepo = dataSource.getRepository(TaskEntity);
        const operationRepo = dataSource.getRepository(OperationsEntity);
        const operationErrorRepo = dataSource.getRepository(OperationErrorEntity);
        const taskErrorRepo = dataSource.getRepository(TaskErrorEntity);
        const speedLogRepo = dataSource.getRepository(SpeedLogEntity);
        const speedLogEntryRepo = dataSource.getRepository(SpeedLogEntryEntity);

        // Initialize services
        logger.log('Initializing services');
        inventoryService = new InventoryService(
            dataSource,
            inventoryRepo,
            taskRepo,
            operationRepo,
            operationErrorRepo,
            taskErrorRepo,
            speedLogRepo,
            speedLogEntryRepo
        );

        const configService = new ConfigService();
        workflowService = new WorkflowService(configService);
        redisConsumerService = new RedisConsumerService(inventoryService, workflowService);
        logger.log('Services initialized successfully');
        
        logger.log('started creating the inventory partition by job run id');
        await inventoryService.createPartitionInventoryTableByJobRunId(jobRunId);
        logger.log('completed creating the inventory partition by job run id');

        // Start consumer
        logger.log(`Starting Redis consumer for job ${jobRunId}`);
        await redisConsumerService.executeConsumersInParallel(jobRunId);
        logger.log(`Redis consumer completed for job ${jobRunId}`);

        // Clean up RedisConsumerService resources
        await redisConsumerService.cleanupResources();

        // Clear timeout since we completed successfully

        logger.log(`Worker completed successfully for job ${jobRunId}`);
        parentPort?.postMessage({ success: true });
    } catch (error) {
        logger.error('Worker error:', error);
        logger.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        
        // Clear timeout on error
        
        parentPort?.postMessage({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        await performCleanup();
        logger.log('Worker thread exiting');
        process.exit(0);
    }
})();
