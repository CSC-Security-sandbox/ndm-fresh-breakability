import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cmd, Command, CommandStatus, GroupReaderType, Task, TaskInfo, TaskStatus, TaskType } from "@netapp-cloud-datamigrate/jobs-lib";
import { Context } from "@temporalio/activity";
import { Connection } from "@temporalio/client";
import { uuid4 } from "@temporalio/workflow";
import { RetryExceededError } from "src/errors/errors.types";
import { RedisService } from "src/redis/redis.service";
import { BuildOrGetScanTaskInput, CreateInitBatchInput } from "./common-task.type";
import { calculateHash } from "src/activities/utils/checksum-utils";
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { calculateCommandHash } from "src/activities/utils/utils";
import { buildTask } from "../utils/utils";
import { InitTaskInput } from "../migrate/sync-activity.type";
import { AuthService } from "src/auth/auth.service";


@Injectable()
export class CommonTaskService {
  private readonly logger : LoggerService;
  readonly workerId: string;
  readonly maxRetryCount: number;
  readonly temporalAddress: string; // Default Temporal address, can be overridden in config
  readonly groupSize: number;
  readonly commandsInTask: number;
  readonly maxCmdStreamLen: number;

  constructor(
      @Inject(ConfigService) private readonly configService: ConfigService,
      @Inject(LoggerFactory) loggerFactory: LoggerFactory,
      private readonly redisService: RedisService,
      private readonly authService: AuthService,
    ) {
      this.workerId = this.configService.get('worker.workerId');
      this.maxRetryCount = this.configService.get('worker.maxRetryCount') || 3;
      this.temporalAddress = this.configService.get('temporal.address') || 'localhost:7233';
      this.groupSize = this.configService.get<number>('worker.groupSize') || 1000;
      this.commandsInTask = this.configService.get<number>('worker.commandsInTask') || 100;
      this.logger = loggerFactory.create(CommonTaskService.name);
      this.maxCmdStreamLen = this.configService.get<number>('worker.maxCmdStreamLen') || 5000;
    }

    // TO-DO : make this adaptive resource based task creation
    async getGroupOfTasksActivity(jobRunId): Promise<string[]> {
      let taskIds: string[] = [];
      try{
        const jobContext = await this.redisService.getJobManagerContext(jobRunId);
        let commands:Cmd[] = [], streamIds = [];
        for await (const {data, id} of jobContext.groupReadCommandStream(jobRunId, this.groupSize, GroupReaderType.WORKER)) {
          commands.push(data);
          streamIds.push(id);
          if (commands.length >= this.commandsInTask) {
            const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
            const hashKey = calculateCommandHash(commands); 
            taskIds.push(hashKey);
            this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
            await jobContext.setTaskIfNotExists(hashKey, task);   
            commands = [];
          }
        }
        if (commands.length > 0) {
          const task = buildTask(TaskType.MIGRATE, jobRunId, jobContext, commands);
          const hashKey = calculateCommandHash(commands); 
          taskIds.push(hashKey);
          this.logger.debug(`Task created with ID: ${task.id} and hash: ${hashKey}`);
          await jobContext.setTaskIfNotExists(hashKey, task);   
          commands = [];
        }
        if(streamIds.length > 0) 
          await jobContext.groupAckCommandStream(streamIds, GroupReaderType.WORKER);
      }catch (error) {
        this.logger.error(`Error in getGroupOfTasksActivity: ${error.message}`, error.stack);
        throw new Error(`Failed to get group of tasks activity: ${error.message}`);
      }
      return taskIds;
    }

  
  async buildOrGetValidScanTask({jobContext , taskHashId , jobRunId, batchId}: BuildOrGetScanTaskInput): Promise<TaskInfo> {
    let task: TaskInfo | undefined = await jobContext.getTask(taskHashId);
    if(!task && batchId) {
      const batch = await jobContext.getBatchDir(batchId);
      if(batch) {
        const commands = batch.map(dir => new Cmd(`${uuid4()}`,dir, CommandStatus.READY, false, {}));
        task =  buildTask(TaskType.SCAN, jobRunId, jobContext, commands);
      }
      await jobContext.setTaskIfNotExists(taskHashId, task);
    }
    task = await this.ensureTaskValid({task, jobContext});
    return task;
  }


  async ensureTaskValid({task, jobContext}: InitTaskInput) : Promise<TaskInfo> {

      if(!task) {
          this.logger.warn('ensureTaskValid called with null/undefined task');
          return null;
      }
      for (let i = 0; i < task?.commands.length; i++) {
        if (task?.commands[i].status !== CommandStatus.COMPLETED)
          task.commands[i].status = CommandStatus.IN_PROCESS
      }
  
      if (task?.retryCount >= this.maxRetryCount) {
        task.status = TaskStatus.ERRORED;
        await jobContext.publishToTaskStream(task);
        throw new RetryExceededError(`Task ${task.id} has exceeded maximum retry count of ${this.maxRetryCount}`);
      }
      return task;
  }

  async isWorkflowRunningActivity(workflowId: string): Promise<boolean> {
    // Build connection config with TLS+JWT if enabled
    const connectionConfig: any = { address: this.temporalAddress };
    
    if (process.env.TEMPORAL_TLS_ENABLED === 'true' && process.env.TEMPORAL_TLS_CA_CERT) {
      const caCertBuffer = Buffer.from(process.env.TEMPORAL_TLS_CA_CERT, 'base64');
      connectionConfig.tls = {
        serverNameOverride: process.env.TEMPORAL_TLS_SERVER_NAME,
        serverRootCACertificate: caCertBuffer,
      };
      this.logger.debug(`Using TLS configuration for workflow check activity`);
    }

    // Add JWT to metadata if enabled
    if (process.env.TEMPORAL_JWT_ENABLED === 'true') {
      try {
        const accessToken = await this.authService.getAccessToken();
        connectionConfig.metadata = {
          authorization: `Bearer ${accessToken}`,
        };
        this.logger.debug(`JWT added to workflow check activity connection metadata`);
      } catch (jwtError) {
        this.logger.error(`Failed to obtain JWT for workflow check activity: ${jwtError}`);
        throw new Error('JWT authentication required but token unavailable');
      }
    }

    const connection = await Connection.connect(connectionConfig);
    this.logger.debug(`Checking if workflow ${workflowId} is running on Temporal at ${this.temporalAddress}`);
    
    try {
      const namespace = 'default'; // replace with your namespace if different
      const resp = await connection.workflowService.describeWorkflowExecution({
        namespace,
        execution: { workflowId },
      });
      // Status 1 means RUNNING
      return resp.workflowExecutionInfo?.status === 1;
    } finally {
      // Always close the connection to avoid leaks
      await connection.close();
    }
  }


  async createInitialDirBatch({dirsToScan, jobRunId}: CreateInitBatchInput): Promise<string>  {
    const jobContext = await this.redisService.getJobManagerContext(jobRunId);
    const batchId: string = calculateHash(dirsToScan);
    await jobContext.setBatchDir(batchId, dirsToScan);
    return batchId;
  }

  async isCmdStreamLenValid(jobRunId:string): Promise<boolean> {
    const jobContext = await this.redisService.getJobManagerContext(jobRunId);
    const currStreamLen =  await jobContext.getCmdStreamLen();
    return this.maxCmdStreamLen >= currStreamLen;
  }
    
}