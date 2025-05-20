import { Injectable, Logger } from '@nestjs/common';
import { DMError, GroupReaderType, JobContext, JobContextFactory, JobType, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { InventoryService } from '../inventory/inventory.service';
import { WorkflowService } from '../workflow/workflow.service';
import { defaultDataConverter } from '@temporalio/common';
import { ConsumerType, StreamStatus, WorkFlows } from '../enum/redis-consumer.enum';
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';

const getWorkflowId = (jobRunId: string, jobType: string) => {
    if (jobType === 'CUT_OVER') return `${WorkFlows.CUT_OVER}-${jobRunId}`;
    if (jobType === 'MIGRATE') return `${WorkFlows.MIGRATE}-${jobRunId}`;
    if (jobType === 'PRECHECK') return `${WorkFlows.PRECHECK}-${jobRunId}`;
    return `${WorkFlows.DISCOVERY}-${jobRunId}`;
}

@Injectable()
export class RedisConsumerService {
    private redisClient: any;

    private consumers: Map<string, StreamStatus> = new Map();
    private isRunningMap: Map<string, boolean> = new Map();
    private accumulatedRecords: any[] = [];
    private readonly keyPrefix = 'consumer';
    private readonly activeConsumersSetKey = 'activeConsumers';
    private logger = new Logger(this.constructor.name);
    private batchSize: number = parseInt(process.env.BATCH_SIZE) || 300;
    private lastFile: string = process.env.LAST_FILE_NAME || "LAST_FILE";
    private processingQueue: Promise<void> = Promise.resolve();



    /**
     * description: Maximum number of concurrent workers
     */

    private MAX_CONCURRENT_WORKERS = 15; // Adjust as needed
    private activeWorkers = 0;
    private jobQueue = [];


    constructor(
        private readonly inventoryService: InventoryService, // Service responsible for handling inventory-related operations
        private readonly workflowService: WorkflowService   // Service responsible for managing workflows and signaling processes
    ) { }


    async onApplicationBootstrap() {
        try {
            // Initialize Redis client
            this.redisClient = await RedisUtils.getClient();

            // Ensure Redis client is connected before proceeding
            if (!this.redisClient.isOpen) await this.redisClient.connect();

            // Clear existing consumer records from Redis to avoid stale data
            await this.redisClient.del("consumers");

            // Retrieve and store the updated list of consumers from Redis
            this.consumers = await this.redisClient.get("consumers");

            // Path to the worker file (used for worker thread execution)
            const workerPath = path.join(__dirname, 'consumerWorker.js');

            // Start pending consumer processes if necessary (uncomment when needed)
            // await this.isPendingStart(); 

            // ✅ Ensuring that the worker file exists and is properly initialized
            if (!fs.existsSync(workerPath)) {
                this.logger.warn(`Worker file not found at path: ${workerPath}`);
            } else {
                this.logger.log(`Worker file located at: ${workerPath}`);
            }

        } catch (error) {
            // Log the error and throw it to prevent silent failures
            this.logger.error('Failed to initialize RedisConsumerService:', error);
            throw error;
        }
    }

    /**
     * Checks for active consumers and restarts them if necessary.
     * This ensures that any consumers that were running before a restart
     * or failure are resumed properly.
     */
    async isPendingStart() {
        // Retrieve the list of active consumers
        const data = await this.listActiveConsumers();

        // Iterate over each active consumer and restart it
        await Promise.all(
            data.map(({ jobRunId, consumerType, readerName }) => {
                this.logger.log(`Consumer ${jobRunId} ${consumerType} ${readerName} in active list`);

                // Restart the consumer process
                return this.startConsumer(jobRunId, readerName, consumerType);
            })
        );
    }

    /**
     * Generates a unique key for identifying a consumer in Redis.
     * This key is used to store and retrieve consumer-related data.
     *
     * @param jobRunId - The unique identifier for the job run.
     * @param consumerType - The type of consumer (e.g., tasks, errors, files).
     * @returns A formatted string representing the consumer key.
     */
    getConsumerKey(jobRunId: string, consumerType: string): string {
        return `${this.keyPrefix}:${jobRunId}:${consumerType}`;
    }

    /**
      * Constructs a unique identifier for a consumer set member.
      * This key format helps track specific consumers within a job.
      *
      * @param jobRunId - The unique identifier for the job run.
      * @param consumerType - The type of consumer (e.g., tasks, errors, files).
      * @param readerName - The name of the consumer reader instance.
      * @returns A formatted string representing the consumer set member.
      */
    private getConsumerSetMember(jobRunId: string, consumerType: string, readerName: string): string {
        return `${jobRunId}:${consumerType}:${readerName}`;
    }

    /**
     * Stops a consumer (or all consumers) associated with a given jobRunId.
     *
     * @param jobRunId - The unique identifier for the job run.
     * @param consumerType - (Optional) The specific consumer type to stop. If omitted, all consumers for the jobRunId will be stopped.
     * @param all - (Optional) If true, stops all consumers regardless of the consumerType.
     */
    async stopConsumer(jobRunId: string, consumerType?: string, all?: boolean) {
        if (all || !consumerType) {
            // Stop all consumers for the given jobRunId
            this.logger.log(`Stopping all consumers for jobRunId: ${jobRunId}`);

            for (const type of Object.values(ConsumerType)) {
                this.logger.log(`Stopping consumer type: ${type}`);

                const key = this.getConsumerKey(jobRunId, type);
                this.logger.log(`Consumer key: ${key}`);

                if (await this.keyExists(key)) {
                    this.logger.log("Key exists. Stopping consumer...");
                    await this.setKey(key, 'false'); // Mark the consumer as stopped in Redis

                    // Retrieve active consumer members from Redis
                    const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);

                    // Remove consumers that match the jobRunId and consumerType
                    for (const member of activeMembers) {
                        const [memberJobRunId, memberConsumerType] = member.split(':');
                        if (memberJobRunId === jobRunId && memberConsumerType === type) {
                            await this.removeFromSet(this.activeConsumersSetKey, member);
                            this.logger.log(`Removed member: ${member}`);
                        }
                    }

                    // Update local state map
                    this.isRunningMap.set(key, false);
                    this.logger.log(`[${jobRunId}] Consumer ${type} is set to stop.`);
                } else {
                    this.logger.log(`[${jobRunId}] Consumer ${type} not found.`);
                }
            }

            this.logger.log(`[${jobRunId}] All consumers have been stopped.`);
        } else {
            // Stop a specific consumer type
            this.logger.log(`Stopping specific consumer for jobRunId: ${jobRunId} and type: ${consumerType}`);

            const key = this.getConsumerKey(jobRunId, consumerType);
            this.logger.log(`Consumer key: ${key}`);

            if (await this.keyExists(key)) {
                this.logger.log("Key exists. Stopping consumer...");
                await this.setKey(key, 'false'); // Mark the consumer as stopped in Redis

                // Retrieve active consumer members from Redis
                const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);

                // Remove consumers that match the jobRunId and consumerType
                for (const member of activeMembers) {
                    const [memberJobRunId, memberConsumerType] = member.split(':');
                    if (memberJobRunId === jobRunId && memberConsumerType === consumerType) {
                        await this.removeFromSet(this.activeConsumersSetKey, member);
                        this.logger.log(`Removed member: ${member}`);
                    }
                }

                // Update local state map
                this.isRunningMap.set(key, false);
                this.logger.log(`[${jobRunId}] Consumer ${consumerType} is set to stop.`);

                // Check if all consumers for this jobRunId are stopped
                const isAllStopped = await this.areAllConsumersStopped(jobRunId);
                if (isAllStopped) {

                    const contextProvider = JobContextFactory.getProvider('redis', this.redisClient);
                    const jobContext = await contextProvider.getJobContext(jobRunId);
                    if (jobContext) {
                        this.logger.log(`[${jobRunId}] All consumers have been stopped. Sending job completion signal to the job context.`);
                        try {
                            if(jobContext && jobContext.jobConfig.jobType != 'CUT_OVER'){
                            //  await jobContext.cleanup(); 
                             this.logger.log(`[${jobRunId}] Job context cleanup completed.`);
                            }else{
                              this.logger.log(`[${jobRunId}] Job context cleanup skipped for CUTOVER job.`);
                            }
                        } catch (error) {
                            this.logger.error(`[${jobRunId}] Error during job cleanup: ${error.message}`);
                        }
                    }

                    this.logger.log(`[${jobRunId}] All consumers are now stopped.`);
                }
            } else {
                this.logger.warn(`[${jobRunId}] Consumer ${consumerType} not found.`);
            }
        }
    }


    /**
     * Checks if all consumers for a given jobRunId are stopped.
     *
     * @param jobRunId - The unique identifier for the job run.
     * @returns A Promise that resolves to `true` if all consumers are stopped, otherwise `false`.
     */
    async areAllConsumersStopped(jobRunId: string): Promise<boolean> {
        // Retrieve all consumer types from the ConsumerType enum
        const types = Object.values(ConsumerType);

        for (const type of types) {
            // Generate a unique key for each consumer type associated with the jobRunId
            const key = this.getConsumerKey(jobRunId, type);

            // Fetch the status of the consumer from Redis
            const value = await this.getKey(key);

            // If any consumer is still active (not marked as 'false'), return false
            if (value !== 'false' && value !== null) {
                return false;
            }
        }

        // If all consumers are stopped, return true
        return true;
    }

    /**
   * Retrieves a list of active consumers from Redis.
   *
   * @returns A Promise resolving to an array of active consumers,
   *          each containing jobRunId, consumerType, readerName, and status (`val`).
   */
    async listActiveConsumers(): Promise<{ jobRunId: string; consumerType: string; readerName: string; val: boolean }[]> {
        // Get all active consumer members from the Redis set
        const activeConsumerMembers = await this.getSetMembers(this.activeConsumersSetKey);
        const activeConsumers: any[] = [];

        for (const member of activeConsumerMembers) {
            try {
                // Split the member string into jobRunId, consumerType, and readerName
                const [jobRunId, consumerType, readerName] = member.split(':');

                // Validate parsed values to ensure correct format
                if (!jobRunId || !consumerType || !readerName) {
                    this.logger.warn(`Invalid member format: ${member}`);
                    continue; // Skip processing this member if the format is incorrect
                }

                // Generate the Redis key to check if the consumer is active
                const key = this.getConsumerKey(jobRunId, consumerType);
                const isActive = await this.isConsumerRunning(key);

                if (isActive) {
                    // If the consumer is active, add it to the result list
                    activeConsumers.push({ jobRunId, consumerType, readerName, val: isActive });
                } else {
                    // If the consumer is inactive, remove it from the Redis set
                    await this.removeFromSet(this.activeConsumersSetKey, member);
                    this.logger.log(`Removed inactive member: ${member}`);
                }
            } catch (error) {
                this.logger.error(`Error processing member ${member}:`, error);
            }
        }

        // Return the list of active consumers
        return activeConsumers;
    }

    /**
     * Starts a consumer process based on the provided jobRunId, consumerType, and readerName.
     * If consumerType is not provided, it iterates through all available consumer types.
     *
     * @param jobRunId - Unique identifier for the job run.
     * @param readerName - Optional reader name, defaults to `{consumerType}-reader` if not provided.
     * @param consumerType - Optional consumer type. If not provided, starts all applicable consumers.
     */
    async startConsumer(jobRunId: string, readerName?: string, consumerType?: string) {
        if (consumerType) {
            // If a specific consumer type is provided, start it immediately with threading
            setImmediate(() => {
                readerName = readerName || `${consumerType}-reader`;
                this.startConsumerWithThreading(jobRunId, readerName, consumerType);
            });
        } else {
            // If no consumer type is provided, iterate through all available consumer types
         
                    setImmediate(() => this.startConsumerWithThreading(jobRunId, readerName, consumerType));
                
        }
    }

    /**
    * Starts a worker thread for the given jobRunId, readerName, and consumerType.
    * The function manages worker count, error handling, and job queue processing.
    *
    * @param jobRunId - Unique identifier for the job run.
    * @param readerName - The name of the reader associated with this consumer.
    * @param consumerType - The type of consumer to start.
    * @returns A promise that resolves when the worker completes or rejects on failure.
    */
    async startConsumerWithThreading(jobRunId: string, readerName: string, consumerType: string): Promise<void> {
        this.activeWorkers++; // Increment active worker count when a worker starts
        return new Promise((resolve, reject) => {
            // Define the path to the worker script
            const workerPath = path.join(__dirname, '../../dist/redis-consumer/consumerWorker.js');
            // Initialize a new worker thread with job details
            const worker = new Worker(workerPath, {
                workerData: { jobRunId, consumerType },
            });

            // Listen for messages from the worker
            worker.on('message', (result) => {
                this.activeWorkers--; // Decrement worker count when task completes
                if (result.success) {
                    resolve(); // Resolve the promise on success
                } else {
                    reject(new Error(result.error)); // Reject with the error message
                }
            });

            // Handle errors occurring in the worker
            worker.on('error', (error) => {
                this.activeWorkers--; // Decrement worker count on error
                reject(error); // Reject the promise with the error
            });

            // Handle worker exit events
            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.error(`Worker stopped unexpectedly with exit code ${code}`);
                }

                // If job queue has pending jobs and worker slots are available, start the next job
                if (this.jobQueue.length > 0 && this.activeWorkers < this.MAX_CONCURRENT_WORKERS) {
                    const nextJob = this.jobQueue.shift(); // Retrieve the next job from the queue
                    this.startConsumerWithThreading(nextJob.jobRunId, nextJob.readerName, nextJob.consumerType);
                }
            });
        });
    }


    /**
     * Starts a consumer for a specific job, reading data continuously until stopped.
     *
     * @param jobRunId - The unique identifier for the job.
     * @param readerName - The name of the reader.
     * @param consumerType - The type of consumer.
     */
    async startConsumerCall(jobRunId: string, readerName: string, consumerType: string) {
        try {
            // Ensure Redis client is connected before proceeding
            if (!this.redisClient.isOpen) await this.redisClient.connect();

            // Get the job context provider for Redis
            const contextProvider = JobContextFactory.getProvider("redis", this.redisClient);

            // Retrieve job context using jobRunId
            const jobContext = await contextProvider.getJobContext(jobRunId);

            // const speedTestContextProvider = JobContextFactory.getSpeedTestProvider("redis", this.redisClient);

            // const speedTestJobContext = await speedTestContextProvider.getJobContext(jobRunId);
            if (!jobContext) {
                // Stop consumer if jobContext is missing and throw an error
                await this.stopConsumer(jobRunId, consumerType);
                throw new Error('jobContext is null');
            }

            // Generate a unique key for this consumer in Redis
            const key = this.getConsumerKey(jobRunId, consumerType);
            await this.setKey(key, 'true'); // Mark the consumer as active in Redis

            // Add the consumer to the active consumers set
            const member = this.getConsumerSetMember(jobRunId, consumerType, readerName);
            await this.addToSet(this.activeConsumersSetKey, member);

            // Extract pathId from job configuration

            // Start processing data as long as the consumer is running
            while (await this.isConsumerRunning(key)) {
                this.logger.log(`[${jobRunId}] Running Process for key: ${key}`);
                let hasData = false;
                // Get the data reader instance
                const reader = this.getReader(jobContext, readerName, consumerType);

                // Iterate over incoming data
                for await (const data of reader) {
                    hasData = true;

                    await this.processData(data, consumerType, jobRunId, jobContext);
                }

                // If no new data is found, log and wait before checking again
                if (!hasData) {
                    this.logger.log(`[${jobRunId}]: ${key} No new data found, sleeping...`);
                    if(consumerType != ConsumerType.files){
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    } // Sleep for 4 seconds
                }

            }
            
            this.logger.log(`[${jobRunId}] : Consumer stopped`);
        } catch (error) {
            // Handle errors, log them, and ensure the consumer is stopped
            this.logger.error(`[${jobRunId}] Error starting consumer: startConsumerCall `, error);
            await this.stopConsumer(jobRunId, consumerType);
        }

        this.logger.log(`[${jobRunId}]:Consumer stopped`);
    }


    /**
     * Processes incoming data based on the consumer type.
     *
     * @param data - The data received from the consumer.
     * @param consumerType - The type of consumer handling this data.
     * @param jobRunId - The unique identifier for the job.
     * @param jobContext - The job context containing metadata.
     */
    private async processData(data: any, consumerType: string, jobRunId: string, jobContext: any) {
        try {

            switch (consumerType) {
                case ConsumerType.errors:
                    // If a specific task ID is encountered, stop the "errors" consumer
                    try {
                        if (data?.tasks?.taskId === '8840625a-b818-42a8-98c8-5c05aaa19106') {
                            await this.stopConsumer(jobRunId, ConsumerType.errors);
                        } else {
                            await this.handleErrors(data);
                        }
                    } catch (e) {
                        this.logger.error(`${jobRunId} :${consumerType} Data updating error`)
                    }
                    break;

                case ConsumerType.tasks:
                case ConsumerType.migrationTask:
                case ConsumerType.updatedTask:
                    if (data?.id === '8840625a-b818-42a8-98c8-5c05aaa19106') {
                        await this.stopConsumer(jobRunId, consumerType);
                        this.logger.log(`${consumerType} : killing `)
                    } else {
                        // Save task data to inventory service
                        await this.inventoryService.saveTasks(data);
                    }
                    break;

                case ConsumerType.directories:
                    // Stop consumer if processing the same file again
                    if (data.fileName === this.lastFile) {
                        await this.stopConsumer(jobRunId, ConsumerType.directories);
                    }
                    break;

                case ConsumerType.files:
                    // Handle file processing
                    const { pathId } = jobContext.jobConfig.sourceFileServer;
                    this.handleFiles(data, jobRunId, pathId, jobContext);
                    break;

                // case ConsumerType.speedtestTask:
                //     // Handle file processing
                //     this.inventoryService.saveSpeedLogsEntries(data);
                //     break;

                default:
                    // Log a warning for unknown consumer types
                    this.logger.warn(`[${jobRunId}] Unknown consumer type: ${consumerType}`);
                    break;
            }
        } catch (error) {
            // Log errors that occur during data processing
            this.logger.error(`[${jobRunId}] Error processing data:`, error);
        }
    }



    /**
     * Handles file data processing in a queue to maintain order.
     *
     * @param data - The file data received from the consumer.
     * @param jobRunId - The unique identifier for the job.
     * @param pathId - The path identifier related to the job context.
     * @param jobContext - The job context containing metadata.
     */
    private async handleFiles(data: any, jobRunId: string, pathId: string, jobContext: any): Promise<void> {
        // Ensure processing happens sequentially
        this.processingQueue = this.processingQueue.then(async () => {
            try {
                // If processing the same file as the last processed one
                if (data.fileName === this.lastFile) {
                    this.logger.log(`Last File call detected: ${data.fileName}`);

                    // Process any remaining records before stopping
                    if (this.accumulatedRecords.length > 0) {
                        this.logger.log(`Processing remaining ${this.accumulatedRecords.length} records before stopping.`);
                        await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
                        this.accumulatedRecords = []; // Clear the buffer
                    }

                    // Mark consumer as stopped
                    this.isRunningMap.set(`${jobRunId}_${ConsumerType.files}`, false);
                    this.logger.log(`Stopping all consumers for jobRunId: ${jobRunId}`);

                    // Attempt to stop the consumer and signal workflow
                    try {
                        const jobType = jobContext.jobConfig.jobType;
                        const workflowId = getWorkflowId(jobRunId, jobType);

                        this.logger.log("----- Sending kill signal to workflow ----");

                        // Stop the file consumer
                        await this.stopConsumer(jobRunId, ConsumerType.files);

                        // Send workflow signal
                        await this.workflowService.signalWorkflow({
                            namespace: "default",
                            workflowExecution: { workflowId },
                            signalName: "reportingSignal",
                            input: {
                                payloads: [defaultDataConverter.payloadConverter.toPayload(`${jobType}_REPORTED`)]
                            },
                        });

                        this.logger.log("----- Kill signal successfully sent ----");
                    } catch (error) {
                        this.logger.error("Error signaling workflow:", error);
                    }

                    return; // Exit early since processing for this file is complete
                }

                // Accumulate data for batch processing
                this.accumulatedRecords.push(data);

                // Process when batch size is reached
                if (this.accumulatedRecords.length >= this.batchSize) {
                    await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
                    this.accumulatedRecords = []; // Reset accumulation
                }
            } catch (error) {
                this.logger.error("Error in processing queue:", error);
            }
        });
    }

    /**
     * Handles errors by saving operation and task-related errors.
     *
     * @param data - The error data containing operation and task errors.
     */
    private async handleErrors(data: any): Promise<void> {
        try {


            const { operation, tasks } = data || {};

            // Save operation error if present
            if (operation) {
                await this.inventoryService.saveOperationError(operation);
                this.logger.log(`Saved operation error: ${JSON.stringify(operation)}`);
            }

            // Save task error if present
            if (tasks) {
                await this.inventoryService.saveTaskError(tasks);
                this.logger.log(`Saved task error: ${JSON.stringify(tasks)}`);
            }
        } catch (error) {
            this.logger.error("handleErrors: Failed to process error data", error);
        }
    }

    /**
     * Returns the appropriate reader function for the given consumer type.
     *
     * @param jobContext - The job context containing reader functions.
     * @param readerName - The name of the reader.
     * @param consumerType - The type of consumer.
     * @returns The appropriate reader function.
     * @throws Error if the consumer type is invalid.
     */
    private getReader(jobContext: JobContext,  readerName: string, consumerType: string) {
        if (!jobContext) {
            throw new Error("getReader: jobContext is null or undefined.");
        }

        const readerMap: Record<string, any> = {
            [ConsumerType.files]: jobContext.readFiles(readerName, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.directories]: jobContext.groupReadDirs(readerName, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.errors]: jobContext.groupReadErrors(readerName, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.tasks]: jobContext.groupReadTasks(readerName, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.migrationTask]: jobContext.groupReadMigrationTask(readerName, 500, GroupReaderType.DB_WRITER),
            [ConsumerType.updatedTask]: jobContext.readUpdatedTaskInfo(readerName, 500, GroupReaderType.DB_WRITER),
        };

        if (!(consumerType in readerMap)) {
            throw new Error(`getReader: Invalid consumer type '${consumerType}'`);
        }

        const reader = readerMap[consumerType];

        if (!reader) {
            throw new Error(`getReader: Reader function not found for consumer type '${consumerType}'`);
        }

        return reader;
    }


    /**
  * Checks if a consumer is currently running.
  *
  * @param key - The Redis key representing the consumer state.
  * @returns A boolean indicating whether the consumer is running.
  */
    async isConsumerRunning(key: string): Promise<boolean> {
        if (!key) {
            this.logger.warn("isConsumerRunning: Key is empty or undefined.");
            return false;
        }

        try {
            const value = await this.getKey(key);
            return value === 'true';
        } catch (error) {
            this.logger.error(`isConsumerRunning: Error fetching key '${key}':`, error);
            return false;
        }
    }

    /**
   * Sets a key in Redis with an optional expiration time.
   *
   * @param key - The Redis key to set.
   * @param value - The value to store.
   * @param ttl - (Optional) Time-to-live in seconds.
   */
    async setKey(key: string, value: string, ttl?: number): Promise<void> {
        if (!key) {
            this.logger.warn("setKey: Key is empty or undefined.");
            return;
        }

        try {
            if (ttl) {
                await this.redisClient.set(key, value, 'EX', ttl);
            } else {
                await this.redisClient.set(key, value);
            }
            this.logger.log(`setKey: Successfully set '${key}' with value '${value}'${ttl ? ` and TTL ${ttl}s` : ''}.`);
        } catch (error) {
            this.logger.error(`setKey: Error setting key '${key}':`, error);
        }
    }
    /**
  * Retrieves a key from Redis.
  *
  * @param key - The Redis key to fetch.
  * @returns The stored value or null if not found.
  */
    async getKey(key: string): Promise<string | null> {
        if (!key) {
            this.logger.warn("getKey: Key is empty or undefined.");
            return null;
        }

        try {
            const value = await this.redisClient.get(key);
            this.logger.log(`getKey: Retrieved '${key}' with value '${value ?? "null"}'.`);
            return value;
        } catch (error) {
            this.logger.error(`getKey: Error retrieving key '${key}':`, error);
            return null;
        }
    }

    /**
    * Deletes a key from Redis.
    *
    * @param key - The Redis key to delete.
    */
    async deleteKey(key: string): Promise<void> {
        if (!key) {
            this.logger.warn("deleteKey: Key is empty or undefined.");
            return;
        }

        try {
            const result = await this.redisClient.del(key);
            if (result === 1) {
                this.logger.log(`deleteKey: Successfully deleted '${key}'.`);
            } else {
                this.logger.warn(`deleteKey: Key '${key}' does not exist.`);
            }
        } catch (error) {
            this.logger.error(`deleteKey: Error deleting key '${key}':`, error);
        }
    }

    /**
     * Checks if a key exists in Redis.
     *
     * @param key - The Redis key to check.
     * @returns A boolean indicating whether the key exists.
     */
    async keyExists(key: string): Promise<boolean> {
        if (!key) {
            this.logger.warn("keyExists: Key is empty or undefined.");
            return false;
        }

        try {
            const result = await this.redisClient.exists(key);
            const exists = result > 0;
            this.logger.log(`keyExists: Key '${key}' exists: ${exists}`);
            return exists;
        } catch (error) {
            this.logger.error(`keyExists: Error checking key '${key}':`, error);
            return false; // Return false in case of an error
        }
    }

    /**
  * Adds a member to a Redis set.
  *
  * @param setKey - The Redis set key.
  * @param member - The member to add to the set.
  */
    async addToSet(setKey: string, member: string): Promise<void> {
        if (!setKey || !member) {
            this.logger.warn("addToSet: setKey or member is empty or undefined.");
            return;
        }

        try {
            const result = await this.redisClient.sAdd(setKey, member);
            if (result > 0) {
                this.logger.log(`addToSet: Successfully added member '${member}' to set '${setKey}'.`);
            } else {
                this.logger.warn(`addToSet: Member '${member}' already exists in set '${setKey}'.`);
            }
        } catch (error) {
            this.logger.error(`addToSet: Error adding member '${member}' to set '${setKey}':`, error);
        }
    }
    /**
     * Removes a member from a Redis set.
     *
     * @param setKey - The Redis set key.
     * @param member - The member to remove from the set.
     */
    async removeFromSet(setKey: string, member: string): Promise<void> {
        if (!setKey || !member) {
            this.logger.warn(`⚠️ removeFromSet: Invalid input - setKey: "${setKey}", member: "${member}"`);
            return;
        }

        try {
            const removed = await this.redisClient.sRem(setKey, member);
            if (removed > 0) {
                this.logger.log(`✅ Successfully removed "${member}" from "${setKey}"`);
            } else {
                this.logger.warn(`⚠️ Member "${member}" was not found in "${setKey}"`);
            }
        } catch (error) {
            this.logger.error(`❌ Error removing "${member}" from "${setKey}":`, error);
        }
    }

    /**
     * Retrieves all members of a Redis set.
     *
     * @param setKey - The Redis set key.
     * @returns A promise resolving to an array of set members.
     */
    async getSetMembers(setKey: string): Promise<string[]> {
        if (!setKey) {
            this.logger.warn(`⚠️ getSetMembers: Invalid setKey provided`);
            return [];
        }

        try {
            const members = await this.redisClient.sMembers(setKey);
            this.logger.log(`📌 Retrieved ${members.length} members from "${setKey}"`);
            return members;
        } catch (error) {
            this.logger.error(`❌ Error retrieving members from "${setKey}":`, error);
            return [];
        }
    }


}