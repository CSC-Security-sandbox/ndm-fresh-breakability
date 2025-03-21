import { Injectable, Logger } from '@nestjs/common';
import { DMError, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { InventoryService } from 'src/inventory/inventory.service';
import { WorkflowService } from 'src/workflow/workflow.service';
import { defaultDataConverter } from '@temporalio/common';
import { ConsumerType, StreamStatus, WorkFlows } from 'src/enum/redis-consumer.enum';



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

    constructor(
        private readonly inventoryService: InventoryService,
        private readonly workflowService: WorkflowService
    ) { }

    async onApplicationBootstrap() {
        try {
            this.redisClient = await RedisUtils.getClient();
            if (!this.redisClient.isOpen) await this.redisClient.connect();
            await this.redisClient.del("consumers");
            this.consumers = await this.redisClient.get("consumers");
            await this.isPendingStart();
        } catch (error) {
            this.logger.error('Failed to initialize RedisConsumerService:', error);
            throw error;
        }
    }

    async isPendingStart() {
        const data = await this.listActiveConsumers();
        this.logger.log("Active Consumers Data:", data);
        await Promise.all(
            data.map(({ jobRunId, consumerType, readerName }) => {
                this.logger.log(`Consumer ${jobRunId} ${consumerType} ${readerName} in active list`);
                return this.startConsumer(jobRunId, readerName, consumerType);
            })
        );
    }


    getConsumerKey(jobRunId: string, consumerType: string): string {
        return `${this.keyPrefix}:${jobRunId}:${consumerType}`;
    }

    private getConsumerSetMember(jobRunId: string, consumerType: string, readerName: string): string {
        return `${jobRunId}:${consumerType}:${readerName}`;
    }



    async stopConsumer(jobRunId: string, consumerType?: string, all?: boolean) {
        if (all || !consumerType) {
            this.logger.log("Stopping all consumers for jobRunId:", jobRunId);

            // Stop all consumers for the given jobRunId
            for (const type of Object.values(ConsumerType)) {
                this.logger.log("Stopping consumer type:", type);

                const key = this.getConsumerKey(jobRunId, type);
                this.logger.log("Consumer key:", key);

                if (await this.keyExists(key)) {
                    this.logger.log("Key exists. Stopping consumer...");

                    // Update Redis state
                    await this.setKey(key, 'false');

                    // Fetch all members of the active consumers set
                    const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);

                    // Remove members that match the jobRunId and consumerType
                    for (const member of activeMembers) {
                        const [memberJobRunId, memberConsumerType] = member.split(':');
                        if (memberJobRunId === jobRunId && memberConsumerType === type) {
                            await this.removeFromSet(this.activeConsumersSetKey, member);
                            this.logger.log(`Removed member: ${member}`);
                        }
                    }

                    // Update local state
                    this.isRunningMap.set(key, false);

                    this.logger.log(`[${jobRunId}] Consumer ${type} is set to stop.`);
                } else {
                    this.logger.log(`[${jobRunId}] Consumer ${type} not found.`);
                }
            }

            this.logger.log(`[${jobRunId}] All consumers have been stopped.`);
        } else {
            this.logger.log("Stopping specific consumer for jobRunId:", jobRunId, "and type:", consumerType);

            const key = this.getConsumerKey(jobRunId, consumerType);
            this.logger.log("Consumer key:", key);

            if (await this.keyExists(key)) {
                this.logger.log("Key exists. Stopping consumer...");

                // Update Redis state
                await this.setKey(key, 'false');

                // Fetch all members of the active consumers set
                const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);

                // Remove members that match the jobRunId and consumerType
                for (const member of activeMembers) {
                    const [memberJobRunId, memberConsumerType] = member.split(':');
                    if (memberJobRunId === jobRunId && memberConsumerType === consumerType) {
                        await this.removeFromSet(this.activeConsumersSetKey, member);
                        this.logger.log(`Removed member: ${member}`);
                    }
                }
                // Update local state
                this.isRunningMap.set(key, false);
                this.logger.log(`[${jobRunId}] Consumer ${consumerType} is set to stop.`);
                // Check if all other consumers for this jobRunId are also false
                const isAllStopped = await this.areAllConsumersStopped(jobRunId);
                if (isAllStopped) {
                    this.logger.log(`[${jobRunId}] All consumers are now stopped.`);
                }
            } else {
                this.logger.warn(`[${jobRunId}] Consumer ${consumerType} not found.`);
            }
        }
    }

    async areAllConsumersStopped(jobRunId: string): Promise<boolean> {
        const types = Object.values(ConsumerType);
        for (const type of types) {
            const key = this.getConsumerKey(jobRunId, type);
            const value = await this.getKey(key);
            if (value !== 'false') {
                return false;
            }
        }
        return true;
    }

    async listActiveConsumers(): Promise<{ jobRunId: string; consumerType: string; readerName: string; val: boolean }[]> {
        const activeConsumerMembers = await this.getSetMembers(this.activeConsumersSetKey);
        const activeConsumers: any = [];
        for (const member of activeConsumerMembers) {
            try {
                // Split the member into jobRunId, consumerType, and readerName
                const [jobRunId, consumerType, readerName] = member.split(':');
                // Validate the fields
                if (!jobRunId || !consumerType || !readerName) {
                    this.logger.warn(`Invalid member format: ${member}`);
                    continue; // Skip invalid members
                }
                // Check if the consumer is active in Redis
                const key = this.getConsumerKey(jobRunId, consumerType);
                const isActive = await this.isConsumerRunning(key);
                // Add the consumer to the result if it is active
                if (isActive) {
                    activeConsumers.push({
                        jobRunId,
                        consumerType,
                        readerName,
                        val: isActive,
                    });
                } else {
                    // this.logger.log(`Consumer ${member} is not active.`);

                }
            } catch (error) {
                this.logger.error(`Error processing member ${member}:`, error);
            }
        }

        return activeConsumers;
    }

    async startConsumer(jobRunId: string, readerName?: string, consumerType?: string) {
        if (consumerType) {
            setImmediate(() => {
                readerName = readerName || `${consumerType}-reader`;
                this.startConsumerCall(jobRunId, readerName, consumerType);
            });
        } else {
            Object.values(ConsumerType).forEach((consumerType) => {
                this.logger.log(`Consumer ${jobRunId} ${consumerType} ${readerName} in active list`);
                readerName = `${consumerType}-reader`;
                console.log("readerName", readerName);
                if (consumerType === ConsumerType.tasks || consumerType === ConsumerType.directories) {
                    return
                }
                setImmediate(() => this.startConsumerCall(jobRunId, readerName, consumerType));
            });
        }
    }

    private async handleStopConsumer(jobRunId: string, consumerType: string | null) {
        this.logger.log(`[${jobRunId}] Stopping consumer: ${consumerType}`);

        if (consumerType === ConsumerType.files) {
            await this.stopConsumer(jobRunId, null, true);
        } else {
            await this.stopConsumer(jobRunId, consumerType);
        }
    }

    async startConsumerCall(jobRunId: string, readerName: string, consumerType: string) {
        try {
            if (!this.redisClient.isOpen) await this.redisClient.connect();

            const contextProvider = JobContextFactory.getProvider("redis", this.redisClient);
            const jobContext = await contextProvider.getJobContext(jobRunId);
            if (!jobContext) {
                await this.stopConsumer(jobRunId, consumerType);
                throw new Error('jobContext is null');
            }
            const key = this.getConsumerKey(jobRunId, consumerType);
            await this.setKey(key, 'true');
            const member = this.getConsumerSetMember(jobRunId, consumerType, readerName);
            await this.addToSet(this.activeConsumersSetKey, member);

            const { pathId } = jobContext.jobConfig.sourceFileServer;

            while (await this.isConsumerRunning(key)) {
                this.logger.log('Active Consumers:', await this.listActiveConsumers());
                this.logger.log(`[${jobRunId}] Running Process for key: ${key}`);
                let hasData = false;
                const reader = this.getReader(jobContext, readerName, consumerType);

                for await (const data of reader) {
                    hasData = true;
                    // if (!(await this.isConsumerRunning(key))) {
                    //     return await this.handleStopConsumer(jobRunId, consumerType);
                    // }
                    await this.processData(data, consumerType, jobRunId, pathId, jobContext);
                }
                if (!hasData) {
                    this.logger.log(`[${jobRunId}]: ${key} No new data found, sleeping...`);
                    await new Promise(resolve => setTimeout(resolve, 4000));
                    if (!(await this.isConsumerRunning(key))) {
                        return await this.handleStopConsumer(jobRunId, consumerType);
                    }
                }
            }

            this.logger.log(`[${jobRunId}] Consumer stopped`);
        } catch (error) {
            this.logger.error(`[${jobRunId}] Error starting consumer:`, error);
            await this.stopConsumer(jobRunId, consumerType);
        }


        this.logger.log(`[${jobRunId}] Consumer stopped`);
    }

    private async processData(data: any, consumerType: string, jobRunId: string, pathId: string, jobContext: any) {
        try {
            switch (consumerType) {
                case ConsumerType.errors:
                    await this.handleErrors(data);
                    break;
                case ConsumerType.tasks:
                    // Handle tasks
                    break;
                case ConsumerType.migrationTask:
                    await this.inventoryService.saveTasks(data);
                    break;
                case ConsumerType.updatedTask:
                    await this.inventoryService.saveTasks(data);
                    break;
                case ConsumerType.directories:
                    // await this.stopConsumer(jobRunId, consumerType);
                    break;
                case ConsumerType.files:
                    this.handleFiles(data, jobRunId, pathId, jobContext);
                    break;
                default:
                    this.logger.warn(`[${jobRunId}] Unknown consumer type: ${consumerType}`);
                    break;
            }
        } catch (error) {
            this.logger.error(`[${jobRunId}] Error processing data:`, error);
        }
    }

    private async handleFiles(data: any, jobRunId: string, pathId: string, jobContext: any): Promise<void> {
        this.processingQueue = this.processingQueue.then(async () => {
            if (data.fileName === this.lastFile) {
                this.logger.log("Last File call==========> ", data.fileName);
                if (this.accumulatedRecords.length > 0) {
                    this.logger.log(`Processing remaining ${this.accumulatedRecords.length} records before stopping.`);
                    await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
                    this.accumulatedRecords = [];
                }

                this.isRunningMap.set(`${jobRunId}_${ConsumerType.files}`, false);
                await this.stopConsumer(jobRunId, undefined, true);
                try {
                    const jobType = jobContext.jobConfig.jobType;
                    const workflowId = getWorkflowId(jobRunId, jobType);
                    this.logger.log("----- Kill signal send to workflow----");
                    await this.workflowService.signalWorkflow({
                        namespace: 'default',
                        workflowExecution: { workflowId: workflowId },
                        signalName: 'reportingSignal',
                        input: { payloads: [defaultDataConverter.payloadConverter.toPayload(`${jobType}_REPORTED`)] }
                    });
                    this.logger.log("----- Kill signal Done to workflow ----");
                } catch (error) {
                    this.logger.error(`Error signaling workflow:`, error);
                }
                this.logger.log(`Killing all consumers for jobRunId: ${jobRunId}`);
                return; // Exit early
            }

            this.accumulatedRecords.push(data);
            if (this.accumulatedRecords.length >= this.batchSize) {
                await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
                this.accumulatedRecords = [];
            }
        }).catch(error => {
            this.logger.error("Error in processing queue:", error);
        });
    }

    private async handleErrors(data: any) {
        const { operation, tasks } = data.error || {};
        if (operation) await this.inventoryService.saveOperationError(operation);
        if (tasks) await this.inventoryService.saveTaskError(tasks);
    }

    private getReader(jobContext: any, readerName: string, consumerType: string) {
        const readerMap = {
            files: jobContext.groupReadFiles(readerName, 500),
            directories: jobContext.readDirs(readerName),
            errors: jobContext.groupReadErrors(readerName, 500),
            tasks: jobContext.readTasks(readerName),
            taskstats: jobContext.groupReadTaskStats(readerName, 500),
            migrationTask: jobContext.readMigrationTask(readerName),
            updatedTask: jobContext.readUpdatedTaskInfo(readerName),
        };

        const reader = readerMap[consumerType];
        if (!reader) throw new Error('Reader not found');
        return reader;
    }

    async isConsumerRunning(key: string): Promise<boolean> {
        const value = await this.getKey(key);
        return value === 'true';
    }
    async setKey(key: string, value: string): Promise<void> {
        await this.redisClient.set(key, value);
    }
    async getKey(key: string): Promise<string | null> {
        return await this.redisClient.get(key);
    }
    async deleteKey(key: string): Promise<void> {
        await this.redisClient.del(key);
    }
    async keyExists(key: string): Promise<boolean> {
        const result = await this.redisClient.exists(key);
        return result === 1;
    }
    async addToSet(setKey: string, member: string): Promise<void> {
        await this.redisClient.sAdd(setKey, member);
    }
    async removeFromSet(setKey: string, member: string): Promise<void> {
        try {
            const removed = await this.redisClient.sendCommand(['SREM', setKey, member]);
            if (removed > 0) {
                this.logger.log(`✅ Removed "${member}" from "${setKey}"`);
            } else {
                this.logger.warn(`⚠️ Member "${member}" not found in "${setKey}"`);
            }
        } catch (error) {
            this.logger.error(`❌ Error removing "${member}" from "${setKey}":`, error);
        }
    }

    async getSetMembers(setKey: string): Promise<string[]> {
        return await this.redisClient.sMembers(setKey);
    }



}