import { parentPort, workerData } from 'worker_threads';
import { INestApplicationContext, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DatabasePool } from './database-pool';
import { AuthService } from '../auth/auth.service';


@Module({
    imports: [HttpModule, ConfigModule.forRoot({ isGlobal: true })],
    providers: [AuthService, WorkflowService],
})
class WorkerModule {}

let dataSource: DataSource;
let workerAppContext: INestApplicationContext | null = null;
let inventoryService: InventoryService | null = null;
let workflowService: WorkflowService | null = null;
let redisConsumerService: RedisConsumerService | null = null;
let authService: AuthService | null = null;
// Basic NestJS logger used before NestJS context is initialized
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
            logger.debug(`projectId: ${projectId} Cleaning up RedisConsumerService`);
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
            logger.debug(`projectId: ${projectId} Releasing database connection`);
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

    let exitCode = 0;

    try {
        // Validate required input
        if (!workerData?.jobRunId) {
            throw new Error('Missing required parameter: jobRunId');
        }

        const jobRunId = workerData.jobRunId;
        logger.debug(`projectId: ${projectId} Processing job: ${jobRunId}`);

        logger.debug(`projectId: ${projectId} Acquiring database connection`);
        dataSource = await dbPool.getConnection();
        logger.debug(`projectId: ${projectId} Database connection acquired`);

        logger.debug(`projectId: ${projectId} Initializing repositories`);
        const inventoryRepo = dataSource.getRepository(InventoryEntity);
        const taskRepo = dataSource.getRepository(TaskEntity);
        const operationRepo = dataSource.getRepository(OperationsEntity);
        const operationErrorRepo = dataSource.getRepository(OperationErrorEntity);
        const taskErrorRepo = dataSource.getRepository(TaskErrorEntity);
        const speedLogRepo = dataSource.getRepository(SpeedLogEntity);
        const speedLogEntryRepo = dataSource.getRepository(SpeedLogEntryEntity);

        logger.debug(`projectId: ${projectId} Initializing services`);
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

        // Initialize NestJS context
        // IMPORTANT: Do NOT pass { logger: false } -- it overrides the global NestJS Logger
        // singleton via Logger.overrideLogger(false), which silently kills ALL logging in
        // the worker thread including RedisConsumerService, AuthService, and this file's
        // own Logger. This caused a production incident where the worker thread silently
        // failed for 25+ hours with zero log output.
        workerAppContext = await NestFactory.createApplicationContext(WorkerModule);

        authService = workerAppContext.get(AuthService);
        workflowService = workerAppContext.get(WorkflowService);

        redisConsumerService = new RedisConsumerService(inventoryService, dataSource, workflowService, authService);
        
        // Set projectId in the worker's cache if available
        if (projectId && jobRunId) {
            redisConsumerService.setProjectIdInCache(jobRunId, projectId);
        }

        // Explicitly await Redis connection before proceeding
        // The constructor fires initializeRedisConnection() without awaiting it
        logger.debug(`projectId: ${projectId} Waiting for Redis connection in worker thread`);
        await redisConsumerService.initializeRedisConnection();
        if (!redisConsumerService.isValidRedisClient()) {
            throw new Error('Worker thread failed to establish Redis connection');
        }
        logger.log(`projectId: ${projectId} Redis connection established in worker thread`);
        
        logger.log(`Services initialized successfully`);

        logger.debug(`started creating the inventory partition by job run id`);
        await inventoryService.createPartitionInventoryTableByJobRunId(jobRunId);
        logger.debug(`completed creating the inventory partition by job run id`);

        logger.log(`Starting Redis consumer for job ${jobRunId}`);
        await redisConsumerService.executeConsumersInParallel(jobRunId);
        logger.log(`Redis consumer completed for job ${jobRunId}`);

        // Clean up RedisConsumerService resources
        await redisConsumerService.cleanupResources();

        logger.log(`Worker completed successfully for job ${jobRunId}`);
        parentPort?.postMessage({ success: true });
    } catch (error) {
        exitCode = 1;
        logger.error(`Worker error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : '');

        parentPort?.postMessage({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        await performCleanup(projectId);
        logger.log(`Worker thread exiting (code ${exitCode})`);
        process.exit(exitCode);
    }
})();
