import { Injectable, OnModuleInit } from '@nestjs/common';
import { DMError, JobContextFactory, RedisUtils, Task } from '@netapp-cloud-datamigrate/jobs-lib';
import { OperationStatus } from 'src/enum/queues.enum';
import { InventoryService } from 'src/inventory/inventory.service';
import { WorkflowService } from 'src/workflow/workflow.service';
import { defaultDataConverter } from '@temporalio/common';

export class StreamStatus {
    isStreamActive: boolean;
    streamKey: string;
    jobRunId: string;
    readerName: string;
    consumerType: string;
}

export enum WorkFlows {
    DISCOVERY = 'DiscoveryWorkflow',
    PRECHECK = 'PreCheckValidationWorkflow',
    MIGRATE = 'MigrationWorkflow',
    CUT_OVER = 'CutOverWorkFlow',
}

export enum ConsumerType {
    files = "files",
    directories = "directories",
    tasks = "tasks",
    updatedTask = "updatedTask",
    errors = 'errors',
    migrationTask = "migrationTask"
}

const getWorkflowId = (jobRunId: string, jobType: string) => {
    if (jobType === 'CUT_OVER') return `${WorkFlows.CUT_OVER}-${jobRunId}`;
    if (jobType === 'MIGRATE') return `${WorkFlows.MIGRATE}-${jobRunId}`;
    if (jobType === 'PRECHECK') return `${WorkFlows.PRECHECK}-${jobRunId}`;
    return `${WorkFlows.DISCOVERY}-${jobRunId}`;
}

@Injectable()
export class RedisConsumerService implements OnModuleInit {
    private redisClient: any;
    private consumers: Map<string, StreamStatus> = new Map();
    private isRunningMap: Map<string, boolean> = new Map();
    private accumulatedRecords: any[] = [];
    private readonly keyPrefix = 'consumer';
    private readonly activeConsumersSetKey = 'activeConsumers';

    constructor(
        private readonly inventoryService: InventoryService,
        private readonly workflowService: WorkflowService
    ) { }

    async onModuleInit() {
        try {
            this.redisClient = await RedisUtils.getClient();
            if (!this.redisClient.isOpen) await this.redisClient.connect();
            await this.redisClient.del("consumers");
            this.consumers = await this.redisClient.get("consumers");
            await this.isPendingStart();
        } catch (error) {
            console.error('Failed to initialize RedisConsumerService:', error);
            throw error;
        }
    }

    async isPendingStart() {
        const data = await this.listActiveConsumers();
        console.log("Active Consumers Data:", data);

        if (data.length > 0) {
            for (const item of data) {
                const { jobRunId, consumerType, readerName } = item;
                console.log(`Consumer ${jobRunId} ${consumerType} ${readerName} in active list`);
                 this.startConsumer(jobRunId, readerName, consumerType);
            }
        }
    }

    getConsumerKey(jobRunId: string, consumerType: string): string {
        return `${this.keyPrefix}:${jobRunId}:${consumerType}`;
    }

    private getConsumerSetMember(jobRunId: string, consumerType: string, readerName: string): string {
        return `${jobRunId}:${consumerType}:${readerName}`;
    }



    async stopConsumer(jobRunId: string, consumerType?: string, all?: boolean) {
        if (all || !consumerType) {
            console.log("Stopping all consumers for jobRunId:", jobRunId);
    
            // Stop all consumers for the given jobRunId
            for (const type of Object.values(ConsumerType)) {
                console.log("Stopping consumer type:", type);
    
                const key = this.getConsumerKey(jobRunId, type);
                console.log("Consumer key:", key);
    
                if (await this.keyExists(key)) {
                    console.log("Key exists. Stopping consumer...");
    
                    // Update Redis state
                    await this.setKey(key, 'false');
                    
                    // Fetch all members of the active consumers set
                    const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);
    
                    // Remove members that match the jobRunId and consumerType
                    for (const member of activeMembers) {
                        const [memberJobRunId, memberConsumerType] = member.split(':');
                        if (memberJobRunId === jobRunId && memberConsumerType === type) {
                            await this.removeFromSet(this.activeConsumersSetKey, member);
                            console.log(`Removed member: ${member}`);
                        }
                    }
    
                    // Update local state
                    this.isRunningMap.set(key, false);
    
                    console.log(`[${jobRunId}] Consumer ${type} is set to stop.`);
                } else {
                    console.log(`[${jobRunId}] Consumer ${type} not found.`);
                }
            }
    
            console.log(`[${jobRunId}] All consumers have been stopped.`);
        } else {
            console.log("Stopping specific consumer for jobRunId:", jobRunId, "and type:", consumerType);
    
            const key = this.getConsumerKey(jobRunId, consumerType);
            console.log("Consumer key:", key);
    
            if (await this.keyExists(key)) {
                console.log("Key exists. Stopping consumer...");
    
                // Update Redis state
                await this.setKey(key, 'false');
    
                // Fetch all members of the active consumers set
                const activeMembers = await this.getSetMembers(this.activeConsumersSetKey);
    
                // Remove members that match the jobRunId and consumerType
                for (const member of activeMembers) {
                    const [memberJobRunId, memberConsumerType] = member.split(':');
                    if (memberJobRunId === jobRunId && memberConsumerType === consumerType) {
                        await this.removeFromSet(this.activeConsumersSetKey, member);
                        console.log(`Removed member: ${member}`);
                    }
                }
    
                // Update local state
                this.isRunningMap.set(key, false);
    
                console.log(`[${jobRunId}] Consumer ${consumerType} is set to stop.`);
    
                // Check if all other consumers for this jobRunId are also false
                const isAllStopped = await this.areAllConsumersStopped(jobRunId);
                if (isAllStopped) {
                    console.log(`[${jobRunId}] All consumers are now stopped.`);
                }
            } else {
                console.warn(`[${jobRunId}] Consumer ${consumerType} not found.`);
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
    
        const activeConsumers:any = [];
    
        for (const member of activeConsumerMembers) {
            try {
                // Split the member into jobRunId, consumerType, and readerName
                const [jobRunId, consumerType, readerName] = member.split(':');
    
                // Validate the fields
                if (!jobRunId || !consumerType || !readerName) {
                    console.warn(`Invalid member format: ${member}`);
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
                    console.log(`Consumer ${member} is not active.`);
                }
            } catch (error) {
                console.error(`Error processing member ${member}:`, error);
            }
        }
    
        return activeConsumers;
    }

      async startConsumer(jobRunId: string, readerName: string, consumerType: string) {
        setImmediate(async () => {
             this.startConsumerfun(jobRunId, readerName, consumerType);
        }
        );
    }


    async startConsumerfun(jobRunId: string, readerName: string, consumerType: string) {
        if (!this.redisClient.isOpen) await this.redisClient.connect();

        const contextProvider = JobContextFactory.getProvider("redis", this.redisClient);
        const jobContext = await contextProvider.getJobContext(jobRunId);
        if (!jobContext) {
            this.stopConsumer(jobRunId, consumerType);
            throw new Error('jobContext is null');
        }
        const key = this.getConsumerKey(jobRunId, consumerType);

        console.log(`[${jobRunId}] Starting consumer key: ${key}`);
        await this.setKey(key, 'true');
        const member = this.getConsumerSetMember(jobRunId, consumerType, readerName);
        await this.addToSet(this.activeConsumersSetKey, member);

        const { pathId } = jobContext.jobConfig.sourceFileServer;

        while (await this.isConsumerRunning(key)) {
            console.log('Active Consumers:', await this.listActiveConsumers());
            console.log(`[${jobRunId}] Starting key: ${key}`);
            let hasData = false;
            const reader = this.getReader(jobContext, readerName, consumerType);

            for await (const data of reader) {
                hasData = true;
                if (!(await this.isConsumerRunning(key))) {
                    console.log(`[${jobRunId}] Stopping consumer: ${consumerType}`);
                    if (consumerType === ConsumerType.files) {
                        this.stopConsumer(jobRunId, undefined, true);

                    }else{
                    this.stopConsumer(jobRunId, consumerType);
                    }
                    return;
                }

                await this.processData(data, consumerType, jobRunId, pathId, jobContext);
            }

            if (!hasData) {
                console.log(`[${jobRunId}] No new data found, sleeping...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }


        console.log(`[${jobRunId}] Consumer stopped`);
    }

    private async processData(data: any, consumerType: string, jobRunId: string, pathId: string, jobContext: any) {
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
                this.stopConsumer(jobRunId, consumerType);
                break;
            case ConsumerType.files:
                await this.handleFiles(data, jobRunId, pathId, jobContext);
                break;
            default:
                console.warn(`[${jobRunId}] Unknown consumer type: ${consumerType}`);
                break;
        }
    }

    private async handleFiles(data: any, jobRunId: string, pathId: string, jobContext: any) {
        if (data.fileName === "LAST_FILE") {
            console.log("data.fileName==========> ", data.fileName);
            if (this.accumulatedRecords.length > 0) {
                console.log(`Processing remaining ${this.accumulatedRecords.length} records before stopping.`);
                await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
                this.accumulatedRecords = []; // Clear after final processing
            }
    
            
            try{
            const jobType = jobContext.jobConfig.jobType;
            const workflowId = getWorkflowId(jobRunId, jobType);
            await this.workflowService.signalWorkflow({
                namespace: 'default',
                workflowExecution: { workflowId: workflowId },
                signalName: 'reportingSignal',
                input: { payloads: [defaultDataConverter.payloadConverter.toPayload(`${jobType}_REPORTED`)] }
            });
        }
        catch (error) {
            console.error(`Error signaling workflow:`, error);
        }

            this.isRunningMap.set(`${jobRunId}_${ConsumerType.files}`, false);
            this.stopConsumer(jobRunId, undefined, true);
            console.log(`[${jobRunId}] Stopping consumer`);
            return;
        }

        // Accumulate records in a batch
        this.accumulatedRecords.push(data);
        const batchSize = 300; // Adjust the batch size as needed
        if (this.accumulatedRecords.length >= batchSize) {
            await this.inventoryService.createInventory(this.accumulatedRecords, jobRunId, pathId);
            this.accumulatedRecords = []; // Reset the accumulator after processing
        }
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
             console.log("setKey", setKey);
                console.log("member", member);
            const removed = await this.redisClient.sendCommand(['SREM', setKey, member]);
            if (removed > 0) {
                console.log(`✅ Removed "${member}" from "${setKey}"`);
            } else {
                console.warn(`⚠️ Member "${member}" not found in "${setKey}"`);
            }
        } catch (error) {
            console.error(`❌ Error removing "${member}" from "${setKey}":`, error);
        }
    }
    

    async getSetMembers(setKey: string): Promise<string[]> {
         console.log("setKey", setKey);
        return await this.redisClient.sMembers(setKey);
    }
}