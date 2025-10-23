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
async function performCleanup(projectId?: string | null) {
    logger.log(`projectId: ${projectId} Starting worker cleanup`);
    try {
        // Clean up RedisConsumerService
        if (redisConsumerService) {
            logger.log(`projectId: ${projectId} Cleaning up RedisConsumerService`);
            try {
                await redisConsumerService.cleanupResources();
            } catch (error) {
                logger.error(`projectId: ${projectId} Error during RedisConsumerService cleanup:`, error);
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
            logger.log(`projectId: ${projectId} Releasing database connection`);
            await dbPool.releaseConnection();
            dataSource = null;
        }
        logger.log(`projectId: ${projectId} Worker cleanup completed`);
    } catch (error) {
        logger.error(`projectId: ${projectId} Error during cleanup:`, error);
    }
}

/**
 * Gracefully handles exit signals and performs cleanup.
 */
async function handleGracefulShutdown(signal: string) {
    const projectId = workerData?.projectId || null;
    logger.warn(`projectId: ${projectId} Received ${signal}, shutting down worker gracefully`);
    
    try {
        await performCleanup(projectId);
        process.exit(0);
    } catch (error) {
        logger.error(`projectId: ${projectId} Error during graceful shutdown:`, error);
        process.exit(1);
    }
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));

process.on('uncaughtException', async (error) => {
    const projectId = workerData?.projectId || null;
    logger.error(`projectId: ${projectId} Uncaught exception:`, error);
    logger.error(`projectId: ${projectId} Stack trace:`, error.stack);
    
    try {
        await performCleanup(projectId);
    } catch (cleanupError) {
        logger.error(`projectId: ${projectId} Error during exception cleanup:`, cleanupError);
    }
    
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    const projectId = workerData?.projectId || null;
    logger.error(`projectId: ${projectId} Unhandled rejection at:`, promise, 'reason:', reason);
    
    try {
        await performCleanup(projectId);
    } catch (cleanupError) {
        logger.error(`projectId: ${projectId} Error during rejection cleanup:`, cleanupError);
    }
    
    process.exit(1);
});



/**
 * Main execution logic for the worker.
 */
(async function runConsumerWorker() {
    const projectId = workerData?.projectId || null;
    logger.log(`projectId: ${projectId} Worker thread starting for jobRunId=${workerData?.jobRunId}`);

    

    try {
        // Validate required input
        if (!workerData?.jobRunId) {
            throw new Error('Missing required parameter: jobRunId');
        }

        const jobRunId = workerData.jobRunId;
        logger.log(`projectId: ${projectId} Processing job: ${jobRunId}`);

        // Acquire database connection
        logger.log(`projectId: ${projectId} Acquiring database connection`);
        dataSource = await dbPool.getConnection();
        logger.log(`projectId: ${projectId} Database connection acquired`);

        // Initialize repositories
        logger.log(`projectId: ${projectId} Initializing repositories`);
        const inventoryRepo = dataSource.getRepository(InventoryEntity);
        const taskRepo = dataSource.getRepository(TaskEntity);
        const operationRepo = dataSource.getRepository(OperationsEntity);
        const operationErrorRepo = dataSource.getRepository(OperationErrorEntity);
        const taskErrorRepo = dataSource.getRepository(TaskErrorEntity);
        const speedLogRepo = dataSource.getRepository(SpeedLogEntity);
        const speedLogEntryRepo = dataSource.getRepository(SpeedLogEntryEntity);

        // Initialize services
        logger.log(`projectId: ${projectId} Initializing services`);
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
        redisConsumerService = new RedisConsumerService(inventoryService, dataSource, workflowService);
        
        // Set projectId in the worker's cache if available
        if (projectId && jobRunId) {
            redisConsumerService.setProjectIdInCache(jobRunId, projectId);
        }
        
        logger.log(`projectId: ${projectId} Services initialized successfully`);

        logger.log(`projectId: ${projectId} started creating the inventory partition by job run id`);
        await inventoryService.createPartitionInventoryTableByJobRunId(jobRunId);
        logger.log(`projectId: ${projectId} completed creating the inventory partition by job run id`);

        // Start consumer
        logger.log(`projectId: ${projectId} Starting Redis consumer for job ${jobRunId}`);
        await redisConsumerService.executeConsumersInParallel(jobRunId);
        logger.log(`projectId: ${projectId} Redis consumer completed for job ${jobRunId}`);

        // Clean up RedisConsumerService resources
        await redisConsumerService.cleanupResources();

        // Clear timeout since we completed successfully

        logger.log(`projectId: ${projectId} Worker completed successfully for job ${jobRunId}`);
        parentPort?.postMessage({ success: true });
    } catch (error) {
        logger.error(`projectId: ${projectId} Worker error:`, error);
        logger.error(`projectId: ${projectId} Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        
        // Clear timeout on error
        
        parentPort?.postMessage({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        await performCleanup(projectId);
        logger.log(`projectId: ${projectId} Worker thread exiting`);
        process.exit(0);
    }
})();
