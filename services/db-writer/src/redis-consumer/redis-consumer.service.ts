import { Injectable, OnModuleDestroy, Inject, Logger, Optional } from '@nestjs/common';
import { GroupReaderType, JobContextFactory, JobManagerContext } from '@netapp-cloud-datamigrate/jobs-lib';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { Worker, isMainThread } from 'worker_threads';
import { ConsumerType } from '../enum/redis-consumer.enum';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FileConsumerContext, getWorkflowId, ReaderStatus } from './utils';
import { defaultDataConverter } from '@temporalio/common';
import { RedisError, ValidationError, WorkerError, ConfigurationError } from '../errors/custom-errors';
import { RedisUtils } from '@netapp-cloud-datamigrate/jobs-lib/dist/redis/redis-utils';
import { SQL_QUERIES } from '../constants/custom-response-message';
import { AuthService } from '../auth/auth.service';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisConsumerService implements OnModuleDestroy {
    // Service-scoped cache for jobRunId to projectId mapping
    private jobRunIdToProjectIdMap: Map<string, string> = new Map();
    private readonly logger: LoggerService;
    private redisClient: RedisClientType;
    private readonly REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'db-writer';
    private lastFile: string = process.env.LAST_FILE_NAME || "LAST_FILE";
    private accumulatedRecords: any[] = [];
    private batchSize: number = parseInt(process.env.BATCH_SIZE) || 500;
    private jobConsumerMap: Map<string, FileConsumerContext> = new Map();
    private readonly batchTimeoutMs = process.env.BATCH_TIMEOUT_MS ? parseInt(process.env.BATCH_TIMEOUT_MS) : 5000;
    private readonly maxRetries: number = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3;
    private lastErrorAndTaskId: string = process.env.LAST_ERROR_AND_TASK_ID || '8840625a-b818-42a8-98c8-5c05aaa19106';
    private readonly ITERATION_LOG_INTERVAL: number = process.env.ITERATION_LOG_INTERVAL ? parseInt(process.env.ITERATION_LOG_INTERVAL) : 50;
    private readonly GC_TRIGGER_INTERVAL: number = process.env.GC_TRIGGER_INTERVAL ? parseInt(process.env.GC_TRIGGER_INTERVAL) : 100;
    private connectionRefreshInterval: NodeJS.Timeout | null = null;
    private readonly jwtAuthEnabled: boolean = process.env.REDIS_JWT_AUTH_ENABLED !== 'false';
    private readonly REDIS_CONNECT_TIMEOUT_MS: number = parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '30000');

    constructor(
        private readonly inventoryService: InventoryService,
        private readonly dataSource: DataSource,
        private readonly workflowService: WorkflowService,
        private readonly authService: AuthService,
        @Optional() @Inject(LoggerFactory) private readonly loggerFactory?: LoggerFactory,
    ) {
        if (this.loggerFactory) {
            this.logger = this.loggerFactory.create(RedisConsumerService.name);
        } else {
            // Fallback to basic NestJS Logger for worker threads
            this.logger = new Logger(RedisConsumerService.name) as any;
        }
        this.initializeRedisConnection();
    }


    /**
     * Initializes Redis connection with JWT authentication
     * Creates a new Redis client if one doesn't exist
     * 
     * @throws {Error} When Redis client initialization fails
     * @returns {Promise<void>}
     */
    async initializeRedisConnection() {
        this.logger.log('Initializing Redis Consumer Service with JWT authentication');
        try {
            if (!this.isValidRedisClient()) {
                const redisClientOptions: any = {
                    url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
                    username: process.env.REDIS_USERNAME || 'default',
                    socket: {
                        connectTimeout: this.REDIS_CONNECT_TIMEOUT_MS,
                        reconnectStrategy: false,
                    },
                };

                if (this.jwtAuthEnabled) {
                    const jwt = await this.authService.getAccessToken();
                    if (!jwt) {
                        throw new Error('Failed to obtain JWT token for Redis authentication');
                    }
                    redisClientOptions.password = jwt;
                    this.logger.log(`Connecting to Redis at ${redisClientOptions.url} with JWT authentication`);
                } else {
                    if (process.env.REDIS_PASSWORD) {
                        redisClientOptions.password = process.env.REDIS_PASSWORD;
                    }
                    this.logger.log(`Connecting to Redis at ${redisClientOptions.url} with password authentication`);
                }
                this.redisClient = createClient(redisClientOptions);

                this.redisClient.on('error', (error) => {
                    this.logger.error(`Redis connection error: ${error.message}`, error?.stack || error);
                });

                this.redisClient.on('connect', () => {
                    this.logger.log('Connected to Redis with JWT authentication (TCP established)');
                });

                this.redisClient.on('ready', () => {
                    this.logger.log('Redis client ready (JWT AUTH completed)');
                });

                // Ensure Redis client is connected before proceeding
                if (!this.redisClient.isOpen) await this.redisClient.connect();
                this.logger.log('Redis client ready');
                
                // Setup automatic connection refresh with new JWT tokens
                this.setupConnectionRefresh();
            }
        } catch (error) {
            this.logger.error(`Error initializing Redis: ${error.message}`, error?.stack || error);
            this.redisClient = null;
            // Retry logic: wait and retry until connection is established
            let attempt = 1;
            while (!this.isValidRedisClient() && attempt <= this.maxRetries) {
                this.logger.warn(`Retrying Redis connection (attempt ${attempt}/${this.maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                try {
                    const retryClientOptions: any = {
                        url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
                        username: process.env.REDIS_USERNAME || 'default',
                        socket: {
                            connectTimeout: this.REDIS_CONNECT_TIMEOUT_MS,
                            reconnectStrategy: false,
                        },
                    };

                    if (this.jwtAuthEnabled) {
                        const jwt = await this.authService.getAccessToken(true);
                        if (!jwt) {
                            throw new Error('Failed to obtain JWT token for Redis retry');
                        }
                        retryClientOptions.password = jwt;
                    } else {
                        if (process.env.REDIS_PASSWORD) {
                            retryClientOptions.password = process.env.REDIS_PASSWORD;
                        }
                    }

                    this.redisClient = createClient(retryClientOptions);
                    if (!this.redisClient.isOpen) await this.redisClient.connect();
                    
                    if (this.isValidRedisClient()) {
                        this.logger.log('Redis client ready after retry');
                        // Setup connection refresh after successful retry
                        this.setupConnectionRefresh();
                        break;
                    }
                } catch (retryError) {
                    this.logger.error(`Retry ${attempt} failed: ${retryError.message}`);
                }
                attempt++;
            }
            if (!this.redisClient) {
                throw error;
            }
        }
    }

    /**
     * Setup automatic Redis connection refresh to use fresh JWT tokens
     * Prevents connection failures when JWT tokens expire
     * Ensures only ONE refresh interval is active at a time
     *
     * Skipped in worker threads: once a Redis connection is authenticated,
     * token expiry does not affect it — Redis does not re-validate tokens on
     * established connections. The worker keeps the connection alive with
     * constant XREADGROUP polling, so idle timeouts do not apply either.
     * Running refresh in workers caused a production incident where the refresh
     * fired 23h after worker start, quit the working client, failed to create
     * a replacement, and silently killed the consumer loop.
     */
    private setupConnectionRefresh(): void {
        if (!this.jwtAuthEnabled) {
            return;
        }

        if (!isMainThread) {
            this.logger.log('Skipping connection refresh setup in worker thread (established connections do not need re-auth)');
            return;
        }

        if (this.connectionRefreshInterval) {
            this.logger.log('Clearing existing connection refresh interval before creating new one');
            clearInterval(this.connectionRefreshInterval);
            this.connectionRefreshInterval = null;
        }
        
        const tokenRefreshMinutes = 1380; // 23 hours (1 hour before 24-hour token expiry)
        const refreshIntervalMs = tokenRefreshMinutes * 60 * 1000;
        
        this.logger.log(`Setting up Redis connection refresh every ${tokenRefreshMinutes / 60} hours`);
        
        this.connectionRefreshInterval = setInterval(async () => {
            try {
                this.logger.log('Proactively refreshing Redis connection with new JWT...');
                await this.refreshConnection();
            } catch (error) {
                this.logger.error(`Failed to refresh Redis connection: ${error.message}`);
            }
        }, refreshIntervalMs);
    }

    /**
     * Refresh Redis connection with a new JWT token.
     * Creates and validates the new connection BEFORE closing the old one,
     * so that if the new connection fails, the old one remains usable.
     */
    private async refreshConnection(): Promise<void> {
        if (!this.jwtAuthEnabled) {
            return;
        }

        this.logger.log('Creating new Redis connection with fresh JWT...');
        
        const jwt = await this.authService.getAccessToken(true);
        if (!jwt) {
            throw new Error('Failed to obtain JWT token for Redis connection refresh');
        }

        const redisClientOptions: any = {
            url: `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
            username: process.env.REDIS_USERNAME || 'default',
            password: jwt,
            socket: {
                connectTimeout: this.REDIS_CONNECT_TIMEOUT_MS,
                reconnectStrategy: false,
            },
        };

        const newClient = createClient(redisClientOptions) as RedisClientType;
        
        newClient.on('error', (error) => {
            this.logger.error(`Redis connection error: ${error.message}`, error?.stack || error);
        });

        await newClient.connect();

        // New client is connected and ready -- now safe to swap and close old
        const oldClient = this.redisClient;
        this.redisClient = newClient;

        if (oldClient?.isOpen) {
            this.logger.log('Closing old Redis connection after successful refresh');
            try {
                await oldClient.quit();
            } catch (error) {
                this.logger.warn(`Error closing old Redis client (non-fatal): ${error.message}`);
            }
        }
        
        this.logger.log('Redis connection refreshed successfully');
    }

    /**
     * Comprehensive cleanup method to release all resources and prevent memory leaks
     * Saves any remaining records to database before cleanup
     * Clears all job consumer contexts, timers, worker tracking, and Redis connections
     * Performs garbage collection if available
     * 
     * Working: 
     * 1. Saves any remaining records in jobConsumerMap to database
     * 2. Clears all flush timers for active jobs
     * 3. Clears error recovery timers
     * 4. Empties pending records
     * 5. Releases Redis client connection
     * 
     * @returns {Promise<void>}
     */
    async cleanupResources(): Promise<void> {
        try {
            this.logger.log('Starting comprehensive cleanup');

            // Save any remaining records to database before cleanup
            if (this.jobConsumerMap.size > 0) {
                this.logger.log(`Found ${this.jobConsumerMap.size} job contexts with potential unsaved records`);

                for (const [jobRunId, context] of this.jobConsumerMap.entries()) {
                    const projectId = await this.getProjectIdFromCache(jobRunId);
                    // Save remaining records to database if any exist
                    if (context.records.length > 0) {
                        this.logger.warn(`projectId: ${projectId} Saving ${context.records.length} unsaved records for job ${jobRunId} during cleanup`);
                        try {
                            await this.inventoryService.createInventory(context.records, context.jobRunId, context.pathId);
                            this.logger.log(`projectId: ${projectId} Successfully saved ${context.records.length} records for job ${jobRunId} during cleanup`);
                        } catch (saveError) {
                            this.logger.error(`projectId: ${projectId} Failed to save ${context.records.length} records for job ${jobRunId} during cleanup:`, saveError);
                        }
                    }

                    // Clear timers
                    if (context.flushTimer) {
                        clearTimeout(context.flushTimer);
                        context.flushTimer = null;
                    }

                    if (context.errorRecoveryTimers && context.errorRecoveryTimers.size > 0) {
                        for (const timer of context.errorRecoveryTimers) {
                            clearTimeout(timer);
                        }
                        context.errorRecoveryTimers.clear();
                    }

                    // Clear records array
                    if (context.records.length > 0) {
                        context.records.length = 0;
                    }
                }

                this.jobConsumerMap.clear();
            }

            // Clear active workers tracking
            if (this.activeWorkers.size > 0) {
                this.activeWorkers.clear();
            }

            if (this.redisClient && this.redisClient.isOpen) {
                await this.redisClient.quit();
                this.logger.log('Redis client disconnected');
            }

            this.accumulatedRecords.length = 0;

            this.logger.log('RedisConsumerService cleanup completed');
        } catch (error) {
            this.logger.error(`Error during cleanup: ${error.message}`, error?.stack || error);
        }
    }


    /**
     * NestJS lifecycle hook - called when module is destroyed
     */
    async onModuleDestroy() {
        this.logger.log('Module destroying, cleaning up resources');
        
        // Clear connection refresh interval
        if (this.connectionRefreshInterval) {
            clearInterval(this.connectionRefreshInterval);
            this.connectionRefreshInterval = null;
            this.logger.log('Redis connection refresh interval cleared');
        }
        
        await this.cleanupResources();
    }

    /**
     * Builds Redis key with consistent prefix for job identification
     * 
     * @param {string} jobId - The unique job identifier
     * @returns {string} - Formatted Redis key: 'db-writer:jobId:'
     */
    private buildRedisKey(jobId: string): string {
        return `${this.REDIS_KEY_PREFIX}:${jobId}:`;
    }

    isValidRedisClient(): boolean {
        return Boolean(this.redisClient && this.redisClient.isOpen);
    }

    /**
     * Retrieves projectId from the cache for a given jobRunId
     * If not found in cache, attempts to fetch from database (handles service restart scenarios)
     * 
     * @param {string} jobRunId - The job run identifier
     * @returns {Promise<string | null>} - The cached projectId or null if not found
     */
    async getProjectIdFromCache(jobRunId: string): Promise<string | null> {
        // First try to get from cache
        let projectId = this.jobRunIdToProjectIdMap.get(jobRunId) || null;

        if (projectId) {
            this.logger.log(`Retrieved projectId: ${projectId} from cache for jobRunId: ${jobRunId}`);
            return projectId;
        }

        // If not in cache, try database lookup (handles service restart scenarios)
        this.logger.log(`ProjectId not found in cache for jobRunId: ${jobRunId}, attempting database lookup`);
        projectId = await this.getProjectIdFromDatabase(jobRunId);

        return projectId;
    }

    /**
     * Clears projectId from cache for a specific jobRunId or all entries
     * 
     * @param {string} [jobRunId] - Optional specific jobRunId to clear. If not provided, clears all cache
     * @returns {void}
     */
    clearProjectIdCache(jobRunId?: string): void {
        if (jobRunId) {
            if (this.jobRunIdToProjectIdMap.has(jobRunId)) {
                this.jobRunIdToProjectIdMap.delete(jobRunId);
                this.logger.debug(`Cleared projectId cache for jobRunId: ${jobRunId}`);
            }
        } else {
            const cacheSize = this.jobRunIdToProjectIdMap.size;
            this.jobRunIdToProjectIdMap.clear();
            this.logger.debug(`Cleared all projectId cache entries: ${cacheSize} items`);
        }
    }

    /**
     * Updates consumer status in Redis with automatic reconnection handling
     * 
     * Working:
     * 1. Checks Redis client availability
     * 2. Reinitializes connection if needed
     * 3. Updates status using Redis HSET command
     * 4. Stores projectId in global map if provided
     * 
     * @param {string} jobId - The job identifier
     * @param {string} consumerType - Type of consumer (files, tasks, errors)
     * @param {ReaderStatus} status - Status to set ('active' or 'inactive')
     * @param {string} [projectId] - Optional projectId to cache for the jobRunId
     * @throws {Error} When Redis client is unavailable
     * @returns {Promise<void>}
     */
    async updateConsumerStatus(jobId: string, consumerType: string, status: ReaderStatus, projectId?: string): Promise<void> {
        if (!this.isValidRedisClient()) {
            const cachedProjectId = await this.getProjectIdFromCache(jobId);
            this.logger.warn(`projectId: ${cachedProjectId} Redis client not available for updateConsumerStatus, attempting to reinitialize`);
            await this.initializeRedisConnection();
            if (!this.isValidRedisClient()) {
                throw new RedisError('Redis client not available');
            }
        }

        // Store projectId in global map if provided
        if (projectId && jobId) {
            this.jobRunIdToProjectIdMap.set(jobId, projectId);
            this.logger.log(`projectId: ${projectId} Cached projectId for jobRunId: ${jobId}`);
        }

        await this.redisClient.hSet(this.buildRedisKey(jobId), consumerType, status);
    }
    /**
     * Retrieves consumer status from Redis with error handling
     * 
     * Working:
     * 1. Validates Redis client connection
     * 2. Attempts reconnection if needed
     * 3. Fetches status using Redis HGET command
     * 
     * @param {string} jobId - The job identifier
     * @param {string} consumerType - Type of consumer to check
     * @returns {Promise<ReaderStatus | null>} - Consumer status or null if unavailable
     */
    async getConsumerStatus(jobId: string, consumerType: string): Promise<ReaderStatus | null> {
        if (!this.isValidRedisClient()) {
            const projectId = await this.getProjectIdFromCache(jobId);
            this.logger.warn(`projectId: ${projectId} Redis client not available for getConsumerStatus, attempting to reinitialize`);
            await this.initializeRedisConnection();
            if (!this.isValidRedisClient()) {
                return null;
            }
        }

        const value = await this.redisClient.hGet(this.buildRedisKey(jobId), consumerType);
        return value as ReaderStatus | null;
    }

    async removeConsumer(jobId: string, consumerType: string): Promise<void> {
        if (!this.isValidRedisClient()) {
            const projectId = await this.getProjectIdFromCache(jobId);
            this.logger.warn(`projectId: ${projectId} Redis client not available for removeConsumer, skipping`);
            return;
        }
        await this.redisClient.hDel(this.buildRedisKey(jobId), consumerType);
    }

    async removeJobFromRedis(jobId: string): Promise<void> {
        if (!this.isValidRedisClient()) {
            const projectId = await this.getProjectIdFromCache(jobId);
            this.logger.warn(`projectId: ${projectId} Redis client not available for removeJobFromRedis, skipping Redis operations`);
        } else {
            await this.redisClient.del(this.buildRedisKey(jobId));
        }
    }
    async getAllConsumerStatuses(jobId: string): Promise<Record<string, ReaderStatus>> {
        try {
            if (!this.isValidRedisClient()) {
                const projectId = await this.getProjectIdFromCache(jobId);
                this.logger.warn(`projectId: ${projectId} Redis client not available, attempting to reinitialize`);
                await this.initializeRedisConnection();

                if (!this.isValidRedisClient()) {
                    this.logger.error(`projectId: ${projectId} Failed to reinitialize Redis client`, new Error('Redis client initialization failed'));
                    return {};
                }
            }

            const result = await this.redisClient.hGetAll(this.buildRedisKey(jobId)) as Record<string, ReaderStatus>;
            return result || {};
        } catch (error) {
            const projectId = await this.getProjectIdFromCache(jobId);
            this.logger.error(`projectId: ${projectId} Error getting consumer statuses for jobRunId=${jobId}: ${error.message}`, error?.stack || error);
            return {};
        }
    }

    private generateConsumerKey(jobId: string, consumerType: string): string {
        return `${jobId}:${consumerType}`;
    }

    // Separate method to mark consumer as locally running (called when actually starting)


    /**
     * Checks if a specific consumer is currently running by querying Redis status
     * 
     * Working:
     * 1. Queries Redis for consumer status
     * 2. Returns true if status is 'active'
     * 3. Handles errors gracefully and logs issues
     * 
     * @param {string} jobId - The job identifier
     * @param {string} consumerType - Type of consumer to check
     * @returns {Promise<boolean>} - True if consumer is running, false otherwise
     */
    async isConsumerRunning(jobId: string, consumerType: string): Promise<boolean> {
        let isRunning = false;

        try {
            const redisStatus = await this.getConsumerStatus(jobId, consumerType);
            isRunning = redisStatus === 'active';
        } catch (error) {
            const projectId = await this.getProjectIdFromCache(jobId);
            this.logger.error(`projectId: ${projectId} Error checking Redis for jobId=${jobId}, consumerType=${consumerType}: ${error.message}`, error?.stack || error);
        }

        return isRunning;
    }



    /**
     * Saves all consumer types as active for a specific job in Redis
     * 
     * Working:
     * 1. Iterates through all ConsumerType enum values
     * 2. Sets each consumer status to 'active' in parallel
     * 3. Uses Promise.all for concurrent execution
     * 
     * @param {string} jobRunId - The job run identifier
     * @returns {Promise<boolean>} - True if successful
     * @throws {Error} When Redis operations fail
     */
    async saveJobConsumersToRedis(jobRunId: string, projectId?: string) {
        try {
            await Promise.all(
                Object.values(ConsumerType).map(async (type) => {
                    await this.updateConsumerStatus(jobRunId, type, 'active', projectId);
                })
            );
            return true;
        } catch (error) {
            const cachedProjectId = await this.getProjectIdFromCache(jobRunId);
            this.logger.error(`projectId: ${cachedProjectId} Error saving consumers to Redis: ${error.message}`, error?.stack || error);
            throw error;
        }
    }


    private activeWorkers: Map<string, number> = new Map(); // jobId -> start timestamp
    private workerRetryCounts: Map<string, number> = new Map(); // jobId -> consecutive failure count
    private readonly maxWorkerRetries: number = parseInt(process.env.MAX_WORKER_RETRIES || '3');
    private readonly workerTimeoutMs: number = parseInt(process.env.WORKER_TIMEOUT_MS || '3600000');

    /**
     * Cron job that monitors Redis for active consumers and manages worker threads
     * Runs every 10 seconds to check for jobs that need processing
     * 
     * Working:
     * 1. Scans Redis for all job keys with db-writer prefix
     * 2. Checks consumer statuses for each job
     * 3. Creates worker threads for jobs with active consumers
     * 4. Cleans up completed or failed jobs
     * 5. Prevents duplicate workers using activeWorkers map
     * 
     * @returns {Promise<void>}
     */
    @Cron(CronExpression.EVERY_30_SECONDS)
    async checkAndStartActiveConsumers() {
        try {
            if (!this.isValidRedisClient()) {
                this.logger.warn('Redis client not available in cron, attempting to reinitialize');
                await this.initializeRedisConnection();
                if (!this.isValidRedisClient()) {
                    this.logger.error('Cannot run cron without Redis client', new Error('Redis client not available for cron job'));
                    return;
                }
            }

            const keys: string[] = await this.redisClient.keys(`${this.REDIS_KEY_PREFIX}:*`);

            for (const key of keys) {
                const match = key.match(/^db-writer:(.+):$/);
                if (!match) continue;
                const jobId = match[1];
                const projectId = await this.getProjectIdFromCache(jobId);

                const consumerStatuses: Record<string, ReaderStatus> = await this.getAllConsumerStatuses(jobId);

                if (Object.values(consumerStatuses).some(status => status === 'active')) {
                    if (this.activeWorkers.has(jobId)) {
                        const startedAt = this.activeWorkers.get(jobId);
                        if (Date.now() - startedAt > this.workerTimeoutMs) {
                            this.logger.warn(`projectId: ${projectId} Worker for job ${jobId} appears hung (running for ${Math.round((Date.now() - startedAt) / 1000)}s), removing tracking to allow respawn`);
                            this.activeWorkers.delete(jobId);
                        } else {
                            continue;
                        }
                    }

                    const retryCount = this.workerRetryCounts.get(jobId) || 0;
                    if (retryCount >= this.maxWorkerRetries) {
                        this.logger.error(`projectId: ${projectId} Worker for job ${jobId} exceeded max retries (${retryCount}/${this.maxWorkerRetries}), stopping consumers`);
                        for (const [consumerType, status] of Object.entries(consumerStatuses)) {
                            if (status === 'active') {
                                await this.stopConsumer(jobId, consumerType).catch(stopError => {
                                    this.logger.error(`projectId: ${projectId} Error stopping consumer ${consumerType} for job ${jobId}:`, stopError);
                                });
                            }
                        }
                        this.workerRetryCounts.delete(jobId);
                        continue;
                    }

                    this.activeWorkers.set(jobId, Date.now());

                    this.createConsumerWorkerThread(jobId)
                        .then(() => {
                            this.activeWorkers.delete(jobId);
                            this.workerRetryCounts.delete(jobId);
                        })
                        .catch(error => {
                            this.logger.error(`projectId: ${projectId} Error in worker thread for job ${jobId}: ${error.message}`, error?.stack || error);
                            this.activeWorkers.delete(jobId);
                            this.workerRetryCounts.set(jobId, (this.workerRetryCounts.get(jobId) || 0) + 1);
                        });
                } else {
                    if (this.activeWorkers.has(jobId)) {
                        this.activeWorkers.delete(jobId);
                    }
                    this.workerRetryCounts.delete(jobId);
                    await this.removeJobFromRedis(jobId);
                }
            }

        } catch (err) {
            this.logger.error(`Error in cron: ${err.message}`, err?.stack || err);
        }
    }

    /**
     * Creates and manages a worker thread for processing job consumers
     * 
     * Working:
     * 1. Creates new Worker thread with job data
     * 3. Handles worker messages, errors, and exit events
     * 4. Cleans up event listeners and resolves/rejects based on worker status
     * 5. Resolves/rejects based on worker success/failure
     * 
     * @param {string} jobRunId - The job run identifier for the worker
     * @returns {Promise<void>} - Resolves when worker completes successfully
     * @throws {Error} When worker fails or times out
     */
    async createConsumerWorkerThread(jobRunId: string): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Creating worker thread for job ${jobRunId}`);

        return new Promise((resolve, reject) => {
            const workerPath = path.join(__dirname, '../../dist/redis-consumer/consumerWorker.js');
            let settled = false;

            const worker = new Worker(workerPath, {
                workerData: { jobRunId, projectId }
            });

            worker.on('message', (result) => {
                if (settled) return;
                settled = true;

                if (result.success) {
                    this.logger.log(`projectId: ${projectId} Worker thread completed successfully for job ${jobRunId}`);
                    resolve();
                } else {
                    this.logger.error(`projectId: ${projectId} Worker thread failed for job ${jobRunId}: ${result.error}`, result.error);
                    reject(new WorkerError(result.error));
                }
            });

            worker.on('error', (error) => {
                if (settled) return;
                settled = true;
                this.logger.error(`projectId: ${projectId} Worker thread error for job ${jobRunId}:`, error);
                reject(error);
            });

            worker.on('exit', (code) => {
                worker.removeAllListeners();

                if (code !== 0 && !settled) {
                    settled = true;
                    this.logger.error(`projectId: ${projectId} Worker stopped unexpectedly with exit code ${code} for job ${jobRunId}`, new WorkerError(`Worker exit code: ${code}`, code));
                    reject(new WorkerError(`Worker exit code: ${code}`, code));
                } else {
                    this.logger.log(`projectId: ${projectId} Worker thread exited normally for job ${jobRunId}`);
                }
            });
        });
    }




    /**
     * Executes multiple consumer types in parallel for a specific job
     * 
     * Working:
     * 1. Retrieves all consumer statuses from Redis
     * 2. Creates consumer loop promises for active consumers
     * 3. Runs all active consumers concurrently using Promise.all
     * 4. Logs progress and handles failures
     * 
     * @param {string} jobRunId - The job run identifier
     * @returns {Promise<void>} - Resolves when all consumers complete
     * @throws {Error} When one or more consumers fail
     */
    async executeConsumersInParallel(jobRunId: string): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting parallel consumers for job ${jobRunId}`);
        const readers: Record<string, ReaderStatus> = await this.getAllConsumerStatuses(jobRunId);
        const consumerPromises: Promise<void>[] = [];

        for (const [consumerType, status] of Object.entries(readers)) {
            if (status === 'active') {
                this.logger.log(`projectId: ${projectId} Starting consumer ${consumerType} for job ${jobRunId}`);
                consumerPromises.push(this.executeConsumerLoop(jobRunId, consumerType));
            }
        }

        if (consumerPromises.length > 0) {
            this.logger.log(`projectId: ${projectId} Running ${consumerPromises.length} consumers for job ${jobRunId}`);
            try {
                await Promise.all(consumerPromises);
                this.logger.log(`projectId: ${projectId} All consumers completed for job ${jobRunId}`);
            } catch (error) {
                this.logger.error(`projectId: ${projectId} One or more consumers failed for jobRunId=${jobRunId}: ${error.message}`, error?.stack || error);
                throw error;
            }
        } else {
            this.logger.warn(`projectId: ${projectId} No active consumers found for job ${jobRunId}`);
        }
    }

    /**
     * Main consumer loop that processes streams for a specific consumer type
     * 
     * Working:
     * 1. Acquires job context from Redis
     * 2. Continuously polls stream while consumer is active
     * 3. Processes data in batches with progress tracking
     * 4. Handles reader errors with retry logic
     * 5. Performs cleanup and final flush on completion
     * 6. Reports processing statistics
     * 
     * @param {string} jobRunId - The job run identifier
     * @param {string} consumerType - Type of consumer (files, tasks, errors)
     * @returns {Promise<void>} - Resolves when consumer loop completes
     * @throws {Error} When consumer fails or context is unavailable
     */
    async executeConsumerLoop(jobRunId: string, consumerType: string): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Starting consumer loop for ${consumerType} in job ${jobRunId}`);
        let jobContext: JobManagerContext | null = null;

        try {
            const contextProvider = JobContextFactory.getJobManagerProvider("redis", this.redisClient);
            jobContext = await contextProvider.getContext(jobRunId);

            if (!jobContext) {
                this.logger.error(`projectId: ${projectId} Job context not found for jobRunId=${jobRunId}`, new ConfigurationError('Job context is null'));
                throw new ConfigurationError('jobContext is null');
            }

            this.logger.log(`projectId: ${projectId} Job context acquired for ${consumerType} in job ${jobRunId}`);
            let dataCount = 0;
            let totalFilesReceived = 0;
            let iterationCount = 0;

            while (await this.isConsumerRunning(jobRunId, consumerType)) {
                iterationCount++;

                let hasData = false;
                let batchFilesReceived = 0;

                try {
                    const reader = this.getStreamReader(jobContext, consumerType);

                    for await (const data of reader) {
                        dataCount++;
                        batchFilesReceived++;
                        totalFilesReceived++;
                        hasData = true;
                        await this.processStreamData(data, consumerType, jobRunId, jobContext);
                    }

                    if (batchFilesReceived > 0) {
                        this.logger.log(`projectId: ${projectId} Processed ${batchFilesReceived} items in iteration ${iterationCount} for ${consumerType} in job ${jobRunId}`);
                    }
                    if (!hasData) {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        this.logger.log(`projectId: ${projectId} No data received in iteration ${iterationCount} for ${consumerType} in job ${jobRunId}, waiting for new data...`);
                    }

                } catch (readerError) {
                    this.logger.error(`projectId: ${projectId} Reader error in iteration ${iterationCount} for job ${jobRunId}: ${readerError.message}`, readerError?.stack || readerError);
                    if (readerError?.message?.includes('NOGROUP')) {
                        break; // Stop processing if no consumer group exists
                    }
                    this.logger.warn(`projectId: ${projectId} No consumer group found for job ${jobRunId}, retrying...`);

                    await new Promise(resolve => {
                        const timeout = setTimeout(resolve, 5000);

                        const context = this.jobConsumerMap.get(jobRunId);
                        if (context) {
                            if (!context.errorRecoveryTimers) {
                                context.errorRecoveryTimers = new Set();
                            }
                            context.errorRecoveryTimers.add(timeout);

                            setTimeout(() => {
                                context.errorRecoveryTimers?.delete(timeout);
                            }, 5000);
                        }
                    });

                }

                if (iterationCount % this.ITERATION_LOG_INTERVAL === 0) {
                    this.logger.log(`projectId: ${projectId} Consumer ${consumerType} completed ${iterationCount} iterations, processed ${totalFilesReceived} total items for job ${jobRunId}`);
                    if (global.gc && iterationCount % this.GC_TRIGGER_INTERVAL === 0) {
                        global.gc();
                    }
                }
            }

            this.logger.log(`projectId: ${projectId} Consumer ${consumerType} stopped for job ${jobRunId}. Total processed: ${totalFilesReceived} items`);

        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error running consumer for jobRunId=${jobRunId} and consumerType=${consumerType}: ${error.message}`, error?.stack || error);
            throw error;
        } finally {
            const context = this.jobConsumerMap.get(jobRunId);
            if (context && context.records.length > 0) {
                this.logger.warn(`projectId: ${projectId} ${context.records.length} unprocessed files remaining for job ${jobRunId}`);

                try {
                    await this.flushInventory(jobRunId, jobContext);
                } catch (flushError) {
                    this.logger.error(`projectId: ${projectId} Failed to flush remaining records during cleanup for job ${jobRunId}:`, flushError);
                }
            }

            this.jobConsumerMap.delete(jobRunId);
            await this.removeConsumer(jobRunId, consumerType);
            jobContext = null;
            this.logger.log(`projectId: ${projectId} Consumer ${consumerType} cleanup completed for job ${jobRunId}`);
        }
    }



    /**
     * Processes individual stream data based on consumer type
     * 
     * Working:
     * 1. Routes data to appropriate processor based on consumer type
     * 2. Handles errors and tasks with special termination conditions
     * 3. Processes files through batching system
     * 4. Acknowledges processed items in Redis streams
     * 5. Logs unknown consumer types
     * 
     * @param {any} stream - Stream data object with id and data properties
     * @param {string} consumerType - Type of consumer processing the data
     * @param {string} jobRunId - The job run identifier
     * @param {JobManagerContext} jobContext - Job context for Redis operations
     * @returns {Promise<void>}
     */
    private async processStreamData(stream: any, consumerType: string, jobRunId: string, jobContext: JobManagerContext) {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        try {
            switch (consumerType) {
                case ConsumerType.errors:
                    try {
                        if (stream?.data?.tasks?.taskId === this.lastErrorAndTaskId) {
                            await this.stopConsumer(jobRunId, ConsumerType.errors);
                        } else {
                            await this.processErrorData(stream.data);
                        }
                        await jobContext.groupAckErrorStream([stream.id], GroupReaderType.DB_WRITER);
                    } catch (e) {
                        this.logger.error(`projectId: ${projectId} Data updating error for ${jobRunId}:${consumerType}`, e?.stack || e);
                    }
                    break;

                case ConsumerType.tasks:
                    if (stream?.data?.id === this.lastErrorAndTaskId) {
                        await this.stopConsumer(jobRunId, ConsumerType.tasks);
                    } else {
                        await this.inventoryService.saveTasks(stream?.data);
                    }
                    await jobContext.groupAckTaskStream([stream.id], GroupReaderType.DB_WRITER);
                    break;

                case ConsumerType.files:
                    const { pathId } = jobContext.jobConfig.sourceFileServer;
                    this.processFileDataInBatches(stream.id, stream?.data, jobRunId, pathId, jobContext);
                    break;

                default:
                    this.logger.warn(`projectId: ${projectId} Unknown consumer type: ${consumerType} for job ${jobRunId}`);
                    break;
            }
        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error processing data for job ${jobRunId}:`, error);
        }
    }

    private async processErrorData(data: any): Promise<void> {
        try {
            const { operation, tasks } = data || {};

            if (operation) {
                await this.inventoryService.saveOperationError(operation);
            }

            if (tasks) {
                await this.inventoryService.saveTaskError(tasks);
            }
        } catch (error) {
            this.logger.error("Failed to process error data", error);
        }
    }

    private getStreamReader(jobContext: JobManagerContext, consumerType: string) {
        if (!jobContext) {
            throw new ValidationError("getReader: jobContext is null or undefined.", 'jobContext');
        }

        const readerMap: Record<string, any> = {
            [ConsumerType.files]: jobContext.groupReadFileStream(`${consumerType}-reader`, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.errors]: jobContext.groupReadErrorStream(`${consumerType}-reader`, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.tasks]: jobContext.groupReadTaskStream(`${consumerType}-reader`, 500, GroupReaderType.DB_WRITER),
        };

        if (!(consumerType in readerMap)) {
            throw new ValidationError(`getReader: Invalid consumer type '${consumerType}'`, 'consumerType');
        }

        const reader = readerMap[consumerType];

        if (!reader) {
            throw new ConfigurationError(`getReader: Reader function not found for consumer type '${consumerType}'`);
        }

        return reader;
    }

    private async signalWorkflowKill(jobContext: JobManagerContext, jobRunId: string) {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        const retryDelay = 1000; // 1 second delay between retries

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const jobType = jobContext.jobConfig.jobType;
                const isRetryRun = !!jobContext.jobConfig.jobRunId;
                const workflowId = getWorkflowId(jobRunId, jobType, isRetryRun);

                await this.workflowService.signalWorkflow({
                    namespace: 'default',
                    workflowExecution: { workflowId },
                    signalName: "reportingSignal",
                    input: {
                        payloads: [defaultDataConverter.payloadConverter.toPayload(`${jobType}_REPORTED`)]
                    },
                });

                this.logger.log(`projectId: ${projectId} Successfully signaled workflow for jobRunId=${jobRunId} on attempt ${attempt}`);

                // Clear the global projectId cache
                if (this.jobRunIdToProjectIdMap.size > 0) {
                    this.logger.log(`Clearing ${this.jobRunIdToProjectIdMap.size} cached projectId mappings`);
                    this.jobRunIdToProjectIdMap.clear();
                }

                return; // Success, exit the retry loop

            } catch (error) {
                this.logger.error(`projectId: ${projectId} Error signaling workflow for jobRunId=${jobRunId} on attempt ${attempt}/${this.maxRetries}:`, error);

                if (attempt === this.maxRetries) {
                    this.logger.error(`projectId: ${projectId} Failed to signal workflow for jobRunId=${jobRunId} after ${this.maxRetries} attempts`);
                    throw error; // Re-throw to handle in caller after all retries exhausted
                }

                // Wait before retrying (except on the last attempt)
                if (attempt < this.maxRetries) {
                    this.logger.log(`projectId: ${projectId} Retrying workflow signal for jobRunId=${jobRunId} in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }
    }

    /**
     * Processes file data in configurable batches with timeout and size-based flushing
     * 
     * Working:
     * 1. Initializes job context if not exists
     * 2. Adds file data with stream ID to records queue
     * 3. Triggers flush when batch size reached
     * 4. Sets timeout-based flush if no timer exists
     * 5. Handles special last file signal for job completion
     * 6. Manages workflow signaling and consumer shutdown
     * 
     * @param {string} fileId - Stream ID for the file
     * @param {any} data - File data to process
     * @param {string} jobRunId - The job run identifier
     * @param {string} pathId - Path identifier for the job
     * @param {JobManagerContext} jobContext - Job context for operations
     * @returns {Promise<void>}
     */
    private async processFileDataInBatches(
        fileId: string,
        data: any,
        jobRunId: string,
        pathId: string,
        jobContext: JobManagerContext
    ): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        if (!data) {
            this.logger.error(`projectId: ${projectId} No data provided for streamId: ${fileId} in job ${jobRunId}`);
            return;
        }

        // Initialize context if not exists
        if (!this.jobConsumerMap.has(jobRunId)) {
            this.logger.log(`projectId: ${projectId} Initializing context for job ${jobRunId}`);
            this.jobConsumerMap.set(jobRunId, {
                jobRunId,
                pathId,
                records: [],
                flushTimer: null,
                errorRecoveryTimers: new Set()
            });
        }

        const context = this.jobConsumerMap.get(jobRunId)!;

        // Handle last file signal
        if (data.fileName === this.lastFile) {
            this.logger.log(`projectId: ${projectId} Last file detected for job ${jobRunId}, triggering final flush and workflow signal`);
            await this.flushInventory(jobRunId, jobContext);
            try {
                await this.signalWorkflowKill(jobContext, jobRunId);
            } catch (error) {
                this.logger.error(`projectId: ${projectId} Failed to signal workflow for job ${jobRunId}:`, error);
            }
            await this.stopConsumer(jobRunId, ConsumerType.files);
            return; // Exit without pushing this record
        }

        const recordWithStreamId = { ...data, streamId: fileId };
        context.records.push(recordWithStreamId);

        // Flush if batch size met
        if (context.records.length >= this.batchSize) {
            this.logger.log(`projectId: ${projectId} Batch size reached (${this.batchSize}), flushing inventory for job ${jobRunId}`);
            await this.flushInventory(jobRunId, jobContext);
        }

        // Flush on timeout
        if (!context.flushTimer) {
            context.flushTimer = setTimeout(() => {
                if (context.flushTimer) {
                    clearTimeout(context.flushTimer);
                    context.flushTimer = null;
                }

                this.logger.log(`projectId: ${projectId} Timeout reached, flushing inventory for job ${jobRunId}`);
                this.flushInventory(jobRunId, jobContext).catch(err => {
                    this.logger.error(`projectId: ${projectId} Timeout flush failed for job ${jobRunId}:`, err);
                });
            }, this.batchTimeoutMs);
        }
    }

    /**
     * Flushes accumulated inventory records to database and acknowledges in Redis
     * 
     * Working:
     * 1. Validates context and record availability
     * 2. Clears any pending flush timers
     * 3. Creates database inventory records via InventoryService
     * 4. Extracts stream IDs for acknowledgment
     * 5. Acknowledges processed files in Redis stream
     * 6. Handles failures by restoring records for retry
     * 7. Logs operation status and statistics
     * 
     * @param jobRunId - The job run identifier
     * @param jobContext - Job context for Redis operations
     * @returns 
     */
    private async flushInventory(jobRunId: string, jobContext: JobManagerContext) {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        const context = this.jobConsumerMap.get(jobRunId);
        if (!context) {
            this.logger.warn(`projectId: ${projectId} No context found for flush operation in job ${jobRunId}`);
            return;
        }

        if (context.records.length === 0) {
            return;
        }

        const recordCount = context.records.length;
        this.logger.log(`projectId: ${projectId} Flushing ${recordCount} records to inventory for job ${jobRunId}`);

        if (context.flushTimer) {
            clearTimeout(context.flushTimer);
            context.flushTimer = null;
        }

        const records = [...context.records];
        context.records.length = 0;

        try {
            await this.inventoryService.createInventory(records, context.jobRunId, context.pathId);

            const streamIds = records
                .map(r => r.streamId)
                .filter(id => id);

            if (streamIds.length !== records.length) {
                this.logger.warn(`projectId: ${projectId} Stream ID count mismatch for job ${jobRunId}! Records: ${records.length}, Stream IDs: ${streamIds.length}`);
            }

            if (streamIds.length > 0) {
                await jobContext.groupAckFileStream(streamIds, GroupReaderType.DB_WRITER);
                this.logger.log(`projectId: ${projectId} Successfully flushed and acknowledged ${streamIds.length} records for job ${jobRunId}`);
            } else {
                this.logger.error(`projectId: ${projectId} No stream IDs found for acknowledgment in job ${jobRunId}`);
            }

        } catch (err) {
            this.logger.error(`projectId: ${projectId} Batch write failed for job ${jobRunId}:`, err);

            // Put records back for retry
            context.records.unshift(...records);
            this.logger.warn(`projectId: ${projectId} Restored ${records.length} records to queue for retry in job ${jobRunId}`);
        }
    }

    /**
     * Stop a specific consumer and clean up resources
     */
    async stopConsumer(jobRunId: string, consumerType: string): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Stopping consumer ${consumerType} for job ${jobRunId}`);
        try {
            await this.updateConsumerStatus(jobRunId, consumerType, 'inactive');
            this.logger.log(`projectId: ${projectId} Consumer ${consumerType} stopped for job ${jobRunId}`);
        } catch (error) {
            this.logger.error(`Error stopping consumer: ${error.message}`);
        }
    }

    /**
     * Stop all consumers for a job and clean up resources
     */
    async stopAllConsumers(jobRunId: string): Promise<void> {
        const projectId = await this.getProjectIdFromCache(jobRunId);
        this.logger.log(`projectId: ${projectId} Stopping all consumers for job ${jobRunId}`);
        try {
            const consumerStatuses = await this.getAllConsumerStatuses(jobRunId);
            const activeConsumers = Object.keys(consumerStatuses).filter(type => consumerStatuses[type] === 'active');

            if (activeConsumers.length > 0) {
                this.logger.log(`projectId: ${projectId} Found ${activeConsumers.length} active consumers to stop for job ${jobRunId}: ${activeConsumers.join(', ')}`);
            }

            await Promise.all(
                Object.keys(consumerStatuses).map(consumerType =>
                    this.stopConsumer(jobRunId, consumerType)
                )
            );

            const context = this.jobConsumerMap.get(jobRunId);
            if (context) {
                if (context.flushTimer) {
                    clearTimeout(context.flushTimer);
                    this.logger.log(`projectId: ${projectId} Cleared flush timer for job ${jobRunId}`);
                }

                if (context.errorRecoveryTimers && context.errorRecoveryTimers.size > 0) {
                    for (const timer of context.errorRecoveryTimers) {
                        clearTimeout(timer);
                    }
                    context.errorRecoveryTimers.clear();
                    this.logger.log(`projectId: ${projectId} Cleared error recovery timers for job ${jobRunId}`);
                }

                if (context.records.length > 0) {
                    this.logger.warn(`projectId: ${projectId} Found ${context.records.length} unprocessed records during shutdown for job ${jobRunId}`);
                }

                this.jobConsumerMap.delete(jobRunId);
            }

            if (this.activeWorkers.has(jobRunId)) {
                const startedAt = this.activeWorkers.get(jobRunId);
                this.activeWorkers.delete(jobRunId);
                this.logger.log(`projectId: ${projectId} Removed worker tracking for job ${jobRunId} (was active for ${startedAt ? Math.round((Date.now() - startedAt) / 1000) : '?'}s)`);
            }

            this.accumulatedRecords.length = 0;
            await this.removeJobFromRedis(jobRunId);
            this.logger.log(`projectId: ${projectId} All consumers stopped and cleaned up for job ${jobRunId}`);

        } catch (error) {
            this.logger.error(`projectId: ${projectId} Error stopping all consumers for job ${jobRunId}: ${error.message}`);
        }
    }

    /**
     * Retrieves projectId from database when not found in cache
     * This method handles service restart scenarios where the cache is lost
     * 
     * @param {string} jobRunId - The job run identifier
     * @returns {Promise<string | null>} - The projectId from database or null if not found
     */
    private async getProjectIdFromDatabase(jobRunId: string): Promise<string | null> {
        try {

            const result = await this.dataSource.query(SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN, [jobRunId]);

            if (result && result.length > 0 && result[0].project_id) {
                const projectId = result[0].project_id;
                this.logger.log(`Retrieved projectId ${projectId} from database for jobRunId ${jobRunId}`);
                // Cache it for future use
                this.setProjectIdInCache(jobRunId, projectId);
                return projectId;
            }

            this.logger.warn(`No projectId found in database for jobRunId ${jobRunId}`);
            return null;
        } catch (error) {
            this.logger.error(`Error getting projectId from database for jobRunId ${jobRunId}: `, error);
            return null;
        }
    }

    /**
     * Manually set projectId in cache - useful for worker threads
     */
    setProjectIdInCache(jobRunId: string, projectId: string): void {
        if (projectId && jobRunId) {
            this.jobRunIdToProjectIdMap.set(jobRunId, projectId);
            this.logger.log(`Manually set projectId: ${projectId} in cache for jobRunId: ${jobRunId}`);
        }
    }

}